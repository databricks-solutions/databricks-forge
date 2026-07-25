"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { CheckCircle2, XCircle, Loader2, Rocket, Layers } from "lucide-react";
import { loadSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployableProposal {
  id: string;
  name: string;
  schemaScope: string;
}

type Step = "schema" | "deploying" | "done";

interface DeployOutcome {
  id: string;
  name: string;
  success: boolean;
  deployedFqn?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MetricViewDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposals: DeployableProposal[];
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MetricViewDeployModal({
  open,
  onOpenChange,
  proposals,
  onComplete,
}: MetricViewDeployModalProps) {
  const defaultSchema = proposals[0]?.schemaScope ?? "";

  const [step, setStep] = useState<Step>("schema");
  const [targetSchema, setTargetSchema] = useState<string[]>(defaultSchema ? [defaultSchema] : []);
  const [outcomes, setOutcomes] = useState<DeployOutcome[]>([]);

  const handleSchemaChange = useCallback(
    (sources: string[], _excluded?: string[], _patterns?: string[]) => {
      if (sources.length > 1) {
        setTargetSchema([sources[sources.length - 1]]);
      } else {
        setTargetSchema(sources);
      }
    },
    [],
  );

  const executeDeploy = useCallback(async () => {
    setStep("deploying");
    const schema = targetSchema[0];
    const results: DeployOutcome[] = [];

    for (const p of proposals) {
      try {
        const res = await fetch(`/api/metric-views/${p.id}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetSchema: schema,
            resourcePrefix: loadSettings().catalogResourcePrefix,
          }),
        });
        const data = await res.json();

        if (res.ok && data.deployed) {
          results.push({
            id: p.id,
            name: p.name,
            success: true,
            deployedFqn: data.fqn,
          });
        } else {
          results.push({
            id: p.id,
            name: p.name,
            success: false,
            error: data.error ?? "Deployment failed",
          });
        }
      } catch (err) {
        results.push({
          id: p.id,
          name: p.name,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    setOutcomes(results);
    setStep("done");
    onComplete();
  }, [targetSchema, proposals, onComplete]);

  function handleClose() {
    onOpenChange(false);
    setTimeout(() => {
      setStep("schema");
      setTargetSchema(defaultSchema ? [defaultSchema] : []);
      setOutcomes([]);
    }, 200);
  }

  const successCount = outcomes.filter((o) => o.success).length;
  const failedCount = outcomes.filter((o) => !o.success).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-violet-500" />
            Deploy Metric View{proposals.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            {step === "schema" &&
              `Choose the target schema where ${proposals.length === 1 ? `"${proposals[0].name}"` : `${proposals.length} metric views`} will be created.`}
            {step === "deploying" && "Deploying metric views to Unity Catalog..."}
            {step === "done" && "Deployment complete."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 py-2">
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
                defaultExpandPath={defaultSchema}
              />
              {proposals.length > 1 && (
                <div className="rounded-md border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Metric views to deploy ({proposals.length})
                  </p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {proposals.map((p) => (
                      <p key={p.id} className="text-xs font-mono truncate" title={p.name}>
                        {p.name}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "deploying" && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500 mb-3" />
              <p className="text-sm text-muted-foreground">
                Deploying {proposals.length} metric view
                {proposals.length !== 1 ? "s" : ""} to{" "}
                <code className="text-xs font-mono">{targetSchema[0]}</code>...
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-2">
              {outcomes.map((o) => (
                <div key={o.id} className="flex items-center gap-2 px-1 py-1">
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
          {step === "schema" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={executeDeploy}
                disabled={targetSchema.length === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                <Rocket className="mr-1 h-4 w-4" />
                Deploy {proposals.length} Metric View
                {proposals.length !== 1 ? "s" : ""}
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
              <Button onClick={handleClose}>{successCount > 0 ? "Done" : "Close"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
