"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { CheckCircle2, XCircle, Loader2, Rocket, AlertTriangle, Layers } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissingMetricView {
  name: string;
  fqn: string;
  proposalId?: string;
  ddl?: string;
  /** FQN where the view already exists (different from the referenced FQN). */
  existingFqn?: string;
}

export interface DeployedResult {
  /** The original FQN referenced in the SQL / space. */
  fqn: string;
  proposalId?: string;
  name: string;
  /** The actual deployed FQN (may differ from `fqn` after rewrite). */
  deployedFqn: string;
}

type Step = "select" | "schema" | "deploying" | "done";

interface DeployOutcome {
  name: string;
  fqn: string;
  success: boolean;
  deployedFqn?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MetricViewDependencyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missing: MissingMetricView[];
  defaultSchema?: string;
  onDeployed: (deployed: DeployedResult[]) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MetricViewDependencyModal({
  open,
  onOpenChange,
  missing,
  defaultSchema,
  onDeployed,
  onCancel,
}: MetricViewDependencyModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(missing.filter((mv) => mv.ddl && !mv.existingFqn).map((mv) => mv.fqn)),
  );
  const [targetSchema, setTargetSchema] = useState<string[]>(defaultSchema ? [defaultSchema] : []);
  const [outcomes, setOutcomes] = useState<DeployOutcome[]>([]);

  const foundElsewhere = useMemo(() => missing.filter((mv) => mv.existingFqn), [missing]);

  const deployable = useMemo(() => missing.filter((mv) => !mv.existingFqn && mv.ddl), [missing]);

  const noDdl = useMemo(() => missing.filter((mv) => !mv.existingFqn && !mv.ddl), [missing]);

  const selectedCount = [...selected].filter((fqn) =>
    deployable.some((mv) => mv.fqn === fqn),
  ).length;

  const allChecked = selectedCount === deployable.length && deployable.length > 0;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  function toggleAsset(fqn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fqn)) next.delete(fqn);
      else next.add(fqn);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deployable.map((mv) => mv.fqn)));
    }
  }

  function handleSchemaChange(sources: string[], _excluded?: string[], _patterns?: string[]) {
    if (sources.length > 1) {
      setTargetSchema([sources[sources.length - 1]]);
    } else {
      setTargetSchema(sources);
    }
  }

  const executeDeploy = useCallback(async () => {
    setStep("deploying");
    const schema = targetSchema[0];
    const toDeploy = deployable.filter((mv) => selected.has(mv.fqn));
    const results: DeployOutcome[] = [];
    const deployed: DeployedResult[] = [];

    // Include "found elsewhere" items as already-resolved rewrites
    for (const mv of foundElsewhere) {
      deployed.push({
        fqn: mv.fqn,
        name: mv.name,
        proposalId: mv.proposalId,
        deployedFqn: mv.existingFqn!,
      });
    }

    for (const mv of toDeploy) {
      if (!mv.proposalId) {
        results.push({ name: mv.name, fqn: mv.fqn, success: false, error: "No proposal ID" });
        continue;
      }

      try {
        const res = await fetch(`/api/metric-views/${mv.proposalId}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetSchema: schema }),
        });
        const data = await res.json();

        if (res.ok && data.deployed) {
          results.push({
            name: mv.name,
            fqn: mv.fqn,
            success: true,
            deployedFqn: data.fqn,
          });
          deployed.push({
            fqn: mv.fqn,
            proposalId: mv.proposalId,
            name: mv.name,
            deployedFqn: data.fqn,
          });
        } else {
          results.push({
            name: mv.name,
            fqn: mv.fqn,
            success: false,
            error: data.error ?? "Deployment failed",
          });
        }
      } catch (err) {
        results.push({
          name: mv.name,
          fqn: mv.fqn,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    setOutcomes(results);
    setStep("done");

    if (deployed.length > 0) {
      onDeployed(deployed);
    }
  }, [targetSchema, deployable, selected, onDeployed, foundElsewhere]);

  function handleClose() {
    if (step === "done") {
      const successCount = outcomes.filter((o) => o.success).length;
      if (successCount === 0) {
        onCancel();
      }
      onOpenChange(false);
    } else {
      onCancel();
      onOpenChange(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const successCount = outcomes.filter((o) => o.success).length;
  const failedCount = outcomes.filter((o) => !o.success).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Metric View Dependencies Required
          </DialogTitle>
          <DialogDescription>
            {step === "select" &&
              `${missing.length} metric view${missing.length !== 1 ? "s" : ""} referenced by this deployment ${missing.length !== 1 ? "need" : "needs"} attention.`}
            {step === "schema" &&
              "Choose the target schema where the metric views will be created."}
            {step === "deploying" && "Deploying metric views to Unity Catalog..."}
            {step === "done" && "Deployment complete."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 py-2">
          {step === "select" && (
            <>
              {/* Already deployed elsewhere -- auto-resolved */}
              {foundElsewhere.length > 0 && (
                <div className="rounded-md border border-green-500/50 bg-green-500/5 p-3">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">
                    Found deployed ({foundElsewhere.length})
                  </p>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    These metric views were found at a different location. Dashboard SQL will be
                    updated automatically.
                  </p>
                  {foundElsewhere.map((mv) => (
                    <div key={mv.fqn} className="flex items-center gap-2 py-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <code className="text-xs font-mono truncate block" title={mv.name}>
                          {mv.name}
                        </code>
                        <p
                          className="text-[10px] text-muted-foreground truncate"
                          title={mv.existingFqn}
                        >
                          {mv.existingFqn}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Needs manual creation -- blocks deployment */}
              {noDdl.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-xs font-medium text-destructive mb-1">
                    Not found ({noDdl.length})
                  </p>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    These metric views have no proposal and could not be found in Unity Catalog.
                    Deploy them from the Metric Views page first.
                  </p>
                  {noDdl.map((mv) => (
                    <div key={mv.fqn} className="flex items-center gap-2 py-1">
                      <XCircle className="h-3 w-3 text-destructive shrink-0" />
                      <code className="text-xs font-mono truncate" title={mv.name}>
                        {mv.name}
                      </code>
                    </div>
                  ))}
                </div>
              )}

              {/* Deployable -- user selects which to deploy */}
              {deployable.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                      <span className="text-xs font-medium">Select All</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {selectedCount} of {deployable.length} selected
                    </span>
                  </div>

                  <div className="rounded-md border divide-y">
                    {deployable.map((mv) => (
                      <div key={mv.fqn} className="flex items-center gap-3 px-3 py-2">
                        <Checkbox
                          checked={selected.has(mv.fqn)}
                          onCheckedChange={() => toggleAsset(mv.fqn)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono truncate" title={mv.name}>
                              {mv.name}
                            </code>
                            <Badge
                              variant="outline"
                              className="text-[9px] shrink-0 border-violet-500/50 text-violet-600"
                            >
                              Metric View
                            </Badge>
                          </div>
                          <p
                            className="text-[10px] text-muted-foreground mt-0.5 truncate"
                            title={mv.fqn}
                          >
                            {mv.fqn}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Only found-elsewhere items and nothing to deploy -- proceed directly */}
              {deployable.length === 0 && foundElsewhere.length > 0 && noDdl.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  All metric views have been resolved. Click &quot;Continue&quot; to proceed with
                  deployment.
                </p>
              )}

              {/* Fully blocked -- no deployable, no found-elsewhere */}
              {deployable.length === 0 && foundElsewhere.length === 0 && noDdl.length > 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Deployment cannot proceed until all metric views are available.
                </p>
              )}
            </>
          )}

          {step === "schema" && (
            <div className="space-y-3">
              <div className="px-1">
                {targetSchema.length > 0 && (
                  <div className="mb-2 flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-violet-500" />
                    <span className="text-sm font-medium text-violet-700 dark:text-violet-400">
                      {targetSchema[0]}
                    </span>
                  </div>
                )}
              </div>
              <CatalogBrowser
                selectedSources={targetSchema}
                onSelectionChange={handleSchemaChange}
                selectionMode="schema"
                defaultExpandPath={defaultSchema ?? ""}
              />
            </div>
          )}

          {step === "deploying" && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500 mb-3" />
              <p className="text-sm text-muted-foreground">
                {selectedCount > 0 ? (
                  <>
                    Deploying {selectedCount} metric view{selectedCount !== 1 ? "s" : ""} to{" "}
                    <code className="text-xs font-mono">{targetSchema[0]}</code>...
                  </>
                ) : (
                  "Resolving metric view references..."
                )}
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-2">
              {outcomes.map((o) => (
                <div key={o.fqn} className="flex items-center gap-2 px-1 py-1">
                  {o.success ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <code className="text-xs font-mono truncate block" title={o.name}>
                      {o.name}
                    </code>
                    {o.success && o.deployedFqn && (
                      <p className="text-[10px] text-green-600 truncate" title={o.deployedFqn}>
                        {o.deployedFqn}
                      </p>
                    )}
                    {!o.success && o.error && (
                      <p className="text-[10px] text-destructive truncate" title={o.error}>
                        {o.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center gap-2">
          {step === "select" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {deployable.length > 0 ? (
                <Button
                  onClick={() => setStep("schema")}
                  disabled={selectedCount === 0 || noDdl.length > 0}
                >
                  Next: Choose Schema
                </Button>
              ) : foundElsewhere.length > 0 && noDdl.length === 0 ? (
                <Button onClick={executeDeploy}>Continue</Button>
              ) : (
                <Button disabled>Next: Choose Schema</Button>
              )}
            </>
          )}

          {step === "schema" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button
                onClick={executeDeploy}
                disabled={targetSchema.length === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                <Rocket className="mr-1 h-4 w-4" />
                Deploy {selectedCount} Metric View{selectedCount !== 1 ? "s" : ""}
              </Button>
            </>
          )}

          {step === "deploying" && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deploying...
            </Button>
          )}

          {step === "done" && (
            <>
              <div className="flex-1 text-xs">
                {successCount > 0 && (
                  <span className="text-green-600 mr-3">{successCount} deployed</span>
                )}
                {failedCount > 0 && <span className="text-destructive">{failedCount} failed</span>}
              </div>
              <Button onClick={handleClose}>{successCount > 0 ? "Continue" : "Close"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
