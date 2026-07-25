"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Layers,
  Rocket,
  AlertTriangle,
  RefreshCw,
  Info,
} from "lucide-react";
import type { GenieEngineRecommendation, MetricViewProposal } from "@/lib/genie/types";
import { loadSettings } from "@/lib/settings";
import {
  MetricViewDependencyModal,
  type MissingMetricView,
  type DeployedResult,
} from "@/components/pipeline/metric-view-dependency-modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "select" | "schema" | "mv-deps" | "deploying" | "done";

interface DeployableAsset {
  id: string;
  domain: string;
  name: string;
  type: "metric_view";
  ddl: string;
  description?: string;
  hasError: boolean;
  classification?: "reuse" | "improve" | "new";
  rationale?: string;
  existingFqn?: string;
  subdomain?: string;
}

interface AssetResult {
  name: string;
  type: "metric_view";
  success: boolean;
  error?: string;
  fqn?: string;
  autoFixed?: boolean;
  errorCategory?: string;
}

interface StrippedRef {
  type: "metric_view";
  identifier: string;
  reason: string;
}

interface DomainResult {
  domain: string;
  assets: AssetResult[];
  spaceId?: string;
  spaceError?: string;
  patchedSpace?: string;
  strippedRefs?: StrippedRef[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GenieDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: GenieEngineRecommendation[];
  runId: string;
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMvProposals(rec: GenieEngineRecommendation): MetricViewProposal[] {
  if (!rec.metricViewProposals) return [];
  try {
    return JSON.parse(rec.metricViewProposals) as MetricViewProposal[];
  } catch {
    return [];
  }
}

function extractDefaultSchema(tables: string[]): string {
  if (tables.length === 0) return "";
  const parts = tables[0].split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenieDeployModal({
  open,
  onOpenChange,
  domains,
  runId,
  onComplete,
}: GenieDeployModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [targetSchema, setTargetSchema] = useState<string[]>([]);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [isRetry, setIsRetry] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Metric view dependency gate
  const [missingMvs, setMissingMvs] = useState<MissingMetricView[]>([]);
  const [checkingDeps, setCheckingDeps] = useState(false);
  const [mvFqnRewrites, setMvFqnRewrites] = useState<Record<string, string>>({});

  // Build all deployable assets from the selected domains
  const allAssets = useMemo<DeployableAsset[]>(() => {
    const assets: DeployableAsset[] = [];
    for (const rec of domains) {
      const mvs = parseMvProposals(rec);
      for (const mv of mvs) {
        assets.push({
          id: `mv:${rec.domain}:${mv.name}`,
          domain: rec.domain,
          name: mv.name,
          type: "metric_view",
          ddl: mv.ddl,
          description: mv.description,
          hasError: mv.validationStatus === "error",
          classification: mv.classification,
          rationale: mv.rationale,
          existingFqn: mv.existingFqn,
          subdomain: mv.subdomain,
        });
      }
    }
    return assets;
  }, [domains]);

  // Default schema from first domain's tables
  const defaultSchema = useMemo(() => extractDefaultSchema(domains[0]?.tables ?? []), [domains]);

  // Reset state on open transition (render-time adjustment avoids useEffect setState lint)
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setStep("select");
    setResults([]);
    setDeployLog([]);
    setIsRetry(false);
    setSelectedAssets(new Set(allAssets.filter((a) => !a.hasError).map((a) => a.id)));
    setTargetSchema(defaultSchema ? [defaultSchema] : []);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  // Auto-scroll deploy log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployLog]);

  const toggleAsset = useCallback((id: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const eligible = allAssets.filter((a) => !a.hasError);
    const allChecked = eligible.every((a) => selectedAssets.has(a.id));
    if (allChecked) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(eligible.map((a) => a.id)));
    }
  }, [allAssets, selectedAssets]);

  // Schema selection -- single-select in CatalogBrowser "schema" mode
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

  // Group assets by domain for display
  const assetsByDomain = useMemo(() => {
    const map = new Map<string, DeployableAsset[]>();
    for (const a of allAssets) {
      const list = map.get(a.domain) ?? [];
      list.push(a);
      map.set(a.domain, list);
    }
    return map;
  }, [allAssets]);

  const hasAssets = allAssets.length > 0;
  const selectedCount = selectedAssets.size;
  const mvCount = allAssets.filter(
    (a) => a.type === "metric_view" && selectedAssets.has(a.id),
  ).length;

  // -------------------------------------------------------------------------
  // Deploy execution
  // -------------------------------------------------------------------------

  async function callDeployApi(
    domainPayloads: Array<{
      domain: string;
      title: string;
      description: string;
      serializedSpace: string;
      metricViews: Array<{ name: string; ddl: string; description?: string }>;
      existingSpaceId?: string;
    }>,
    schema: string,
    log: (msg: string) => void,
  ): Promise<DomainResult[] | null> {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: domainPayloads,
          targetSchema: schema,
          authMode: loadSettings().genieDeployAuthMode,
          resourcePrefix: loadSettings().catalogResourcePrefix,
          ...(Object.keys(mvFqnRewrites).length > 0 && { fqnRewrites: mvFqnRewrites }),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        log(`ERROR: ${data.error ?? "Deploy request failed"}`);
        return null;
      }

      const data = await res.json();

      // Fire-and-forget: poll for completion
      if (data.jobId) {
        log("Deploy started in background, polling for progress...");
        return await pollPipelineDeploy(data.jobId, log);
      }

      // Backward compat: synchronous response
      return (data as { results: DomainResult[] }).results;
    } catch (err) {
      log(`ERROR: ${err instanceof Error ? err.message : "Unknown error"}`);
      return null;
    }
  }

  async function pollPipelineDeploy(
    jobId: string,
    log: (msg: string) => void,
  ): Promise<DomainResult[] | null> {
    const maxAttempts = 120;
    let delay = 2000;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const res = await fetch(`/api/runs/${runId}/genie-deploy?jobId=${jobId}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.message) log(data.message);
        if (data.status === "completed") {
          return data.results;
        }
        if (data.status === "failed") {
          log(`ERROR: ${data.error ?? "Deployment failed"}`);
          return null;
        }
        delay = Math.min(delay * 1.3, 8000);
      } catch {
        /* retry */
      }
    }
    log("ERROR: Deploy timed out waiting for completion");
    return null;
  }

  function logResults(domainResults: DomainResult[], log: (msg: string) => void) {
    for (const dr of domainResults) {
      for (const ar of dr.assets) {
        if (ar.success && ar.autoFixed) {
          log(`  Metric view "${ar.name}" auto-fixed and created at ${ar.fqn}`);
        } else if (ar.success) {
          log(`  Metric view "${ar.name}" created at ${ar.fqn}`);
        } else {
          log(`  Metric view "${ar.name}" FAILED: ${ar.error}`);
        }
      }
      if (dr.strippedRefs && dr.strippedRefs.length > 0) {
        log(`  Stripped ${dr.strippedRefs.length} invalid reference(s) from space payload`);
      }
      if (dr.spaceId) {
        log(`Genie space "${dr.domain}" deployed (${dr.spaceId})`);
      } else if (dr.spaceError) {
        log(`Genie space "${dr.domain}" FAILED: ${dr.spaceError}`);
      }
    }
  }

  async function checkDepsAndDeploy() {
    setCheckingDeps(true);

    try {
      // Extract metric view FQNs from all serialized spaces
      const allFqns: string[] = [];
      for (const rec of domains) {
        try {
          const space = JSON.parse(rec.serializedSpace);
          const mvs = space?.data_sources?.metric_views;
          if (Array.isArray(mvs)) {
            for (const mv of mvs) {
              if (typeof mv.identifier === "string" && mv.identifier.split(".").length >= 3) {
                allFqns.push(mv.identifier);
              }
            }
          }
        } catch {
          // skip unparseable spaces
        }
      }

      // Subtract FQNs the user is already deploying (those will be created by the backend)
      const deployingNames = new Set<string>();
      for (const rec of domains) {
        const mvs = parseMvProposals(rec);
        for (const mv of mvs) {
          if (selectedAssets.has(`mv:${rec.domain}:${mv.name}`)) {
            deployingNames.add(mv.name.toLowerCase());
          }
        }
      }

      const fqnsToCheck = allFqns.filter((fqn) => {
        const name = fqn.split(".").pop()?.toLowerCase() ?? "";
        return !deployingNames.has(name);
      });

      if (fqnsToCheck.length === 0) {
        executeDeploy();
        return;
      }

      const res = await fetch("/api/metric-views/check-dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fqns: fqnsToCheck }),
      });

      if (!res.ok) {
        executeDeploy();
        return;
      }

      const data = await res.json();

      if (data.allDeployed || !data.missing || data.missing.length === 0) {
        executeDeploy();
        return;
      }

      setMissingMvs(data.missing);
      setStep("mv-deps");
    } catch {
      executeDeploy();
    } finally {
      setCheckingDeps(false);
    }
  }

  async function executeDeploy() {
    setStep("deploying");
    setDeployLog([]);
    setResults([]);
    setIsRetry(false);

    const schema = targetSchema[0] ?? defaultSchema;
    const log = (msg: string) => setDeployLog((prev) => [...prev, msg]);

    log(`Target schema: ${schema}`);
    log(`Deploying ${domains.length} domain(s)...`);

    const domainPayloads = domains.map((rec) => {
      const selectedMvs = parseMvProposals(rec).filter((mv) =>
        selectedAssets.has(`mv:${rec.domain}:${mv.name}`),
      );

      return {
        domain: rec.domain,
        title: rec.title,
        description: rec.description,
        serializedSpace: rec.serializedSpace,
        metricViews: selectedMvs.map((mv) => ({
          name: mv.name,
          ddl: mv.ddl,
          description: mv.description,
        })),
      };
    });

    const totalMvs = domainPayloads.reduce((s, d) => s + d.metricViews.length, 0);
    if (totalMvs > 0) log(`Creating ${totalMvs} metric view(s)...`);
    else log("No metric views selected -- deploying spaces only");

    const domainResults = await callDeployApi(domainPayloads, schema, log);
    if (domainResults) {
      setResults(domainResults);
      logResults(domainResults, log);
      log("Done.");
    }

    setStep("done");
  }

  async function retryFailed() {
    setStep("deploying");
    setIsRetry(true);
    const prevLog = deployLog;
    const log = (msg: string) => setDeployLog((prev) => [...prev, msg]);

    setDeployLog([...prevLog, "", "--- Retrying failed assets ---"]);

    const schema = targetSchema[0] ?? defaultSchema;

    const retryPayloads = results
      .filter((dr) => {
        const hasFailedAssets = dr.assets.some((a) => !a.success);
        const hasFailedSpace = !!dr.spaceError;
        return hasFailedAssets || hasFailedSpace;
      })
      .map((dr) => {
        const failedMvNames = new Set(
          dr.assets.filter((a) => !a.success && a.type === "metric_view").map((a) => a.name),
        );

        const rec = domains.find((d) => d.domain === dr.domain);
        if (!rec) return null;

        const retryMvs = parseMvProposals(rec).filter((mv) => failedMvNames.has(mv.name));

        return {
          domain: rec.domain,
          title: rec.title,
          description: rec.description,
          serializedSpace: dr.patchedSpace ?? rec.serializedSpace,
          metricViews: retryMvs.map((mv) => ({
            name: mv.name,
            ddl: mv.ddl,
            description: mv.description,
          })),
          existingSpaceId: dr.spaceId,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (retryPayloads.length === 0) {
      log("No failed assets to retry.");
      setStep("done");
      return;
    }

    const totalRetryAssets = retryPayloads.reduce((s, d) => s + d.metricViews.length, 0);
    log(`Retrying ${totalRetryAssets} failed asset(s) across ${retryPayloads.length} domain(s)...`);

    const retryResults = await callDeployApi(retryPayloads, schema, log);
    if (retryResults) {
      // Merge retry results into existing results
      const merged = results.map((prev) => {
        const retried = retryResults.find((r) => r.domain === prev.domain);
        if (!retried) return prev;

        // Merge assets: replace failed ones with retry results, keep successes
        const retriedNames = new Set(retried.assets.map((a) => `${a.type}:${a.name}`));
        const keptAssets = prev.assets.filter((a) => !retriedNames.has(`${a.type}:${a.name}`));
        const mergedAssets = [...keptAssets, ...retried.assets];

        return {
          domain: prev.domain,
          assets: mergedAssets,
          spaceId: retried.spaceId ?? prev.spaceId,
          spaceError: retried.spaceError,
          patchedSpace: retried.patchedSpace ?? prev.patchedSpace,
          strippedRefs: retried.strippedRefs ?? prev.strippedRefs,
        };
      });

      setResults(merged);
      logResults(retryResults, log);
      log("Retry complete.");
    }

    setStep("done");
  }

  // -------------------------------------------------------------------------
  // Summary stats for done step
  // -------------------------------------------------------------------------

  const successSpaces = results.filter((r) => !!r.spaceId).length;
  const failedSpaces = results.filter((r) => !!r.spaceError).length;
  const successAssets = results.flatMap((r) => r.assets).filter((a) => a.success).length;
  const failedAssets = results.flatMap((r) => r.assets).filter((a) => !a.success).length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (step === "deploying" || step === "mv-deps") return;
        if (!o && step === "done") onComplete();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-violet-500" />
            Deploy Genie Spaces
          </DialogTitle>
          <DialogDescription>
            {step === "select" && "Select metric views to deploy alongside your Genie spaces."}
            {step === "schema" && "Choose the target schema where metric views will be created."}
            {step === "deploying" && "Deploying assets and creating Genie spaces..."}
            {step === "done" && "Deployment complete."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-1">
          <StepIndicator label="1. Assets" active={step === "select"} done={step !== "select"} />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator
            label="2. Schema"
            active={step === "schema"}
            done={step === "mv-deps" || step === "deploying" || step === "done"}
          />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator
            label="3. Deploy"
            active={step === "mv-deps" || step === "deploying" || step === "done"}
            done={step === "done"}
          />
        </div>

        <Separator />

        {/* Step content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {step === "select" && (
            <SelectAssetsStep
              assetsByDomain={assetsByDomain}
              selectedAssets={selectedAssets}
              toggleAsset={toggleAsset}
              toggleAll={toggleAll}
              allAssets={allAssets}
              hasAssets={hasAssets}
            />
          )}

          {step === "schema" && (
            <SchemaStep
              targetSchema={targetSchema}
              onSchemaChange={handleSchemaChange}
              defaultSchema={defaultSchema}
            />
          )}

          {(step === "deploying" || step === "done") && (
            <DeployStep deployLog={deployLog} results={results} step={step} logEndRef={logEndRef} />
          )}
        </div>

        {/* Metric view dependency modal (overlay) */}
        <MetricViewDependencyModal
          open={step === "mv-deps"}
          onOpenChange={(o) => {
            if (!o) setStep("schema");
          }}
          missing={missingMvs}
          defaultSchema={targetSchema[0] ?? defaultSchema}
          onDeployed={(deployed: DeployedResult[]) => {
            const rewrites: Record<string, string> = {};
            for (const d of deployed) {
              if (d.fqn !== d.deployedFqn) {
                rewrites[d.fqn] = d.deployedFqn;
              }
              const bareName = d.name.toLowerCase();
              const fqnLower = d.fqn.toLowerCase();
              if (bareName !== fqnLower && !rewrites[d.name]) {
                rewrites[d.name] = d.deployedFqn;
              }
            }
            setMvFqnRewrites(rewrites);
            executeDeploy();
          }}
          onCancel={() => {
            setStep("schema");
          }}
        />

        <Separator />

        <DialogFooter>
          {step === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {selectedCount > 0 ? (
                <Button onClick={() => setStep("schema")}>
                  Next: Choose Schema
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  disabled={!defaultSchema || checkingDeps}
                  title={
                    !defaultSchema
                      ? "No target schema could be inferred — select assets first"
                      : undefined
                  }
                  onClick={() => {
                    setTargetSchema([defaultSchema]);
                    checkDepsAndDeploy();
                  }}
                >
                  {checkingDeps ? "Checking..." : "Deploy Spaces Only"}
                  <Rocket className="ml-1 h-4 w-4" />
                </Button>
              )}
            </>
          )}

          {step === "schema" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <div className="flex-1" />
              <div className="text-xs text-muted-foreground mr-2 self-center">
                {mvCount > 0 && `${mvCount} metric view${mvCount !== 1 ? "s" : ""}`}
                {mvCount > 0 && " + "}
                {domains.length} space{domains.length !== 1 ? "s" : ""}
              </div>
              <Button
                onClick={checkDepsAndDeploy}
                disabled={targetSchema.length === 0 || checkingDeps}
                className="bg-green-600 hover:bg-green-700"
              >
                {checkingDeps ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-1 h-4 w-4" />
                )}
                {checkingDeps ? "Checking..." : "Deploy All"}
              </Button>
            </>
          )}

          {step === "deploying" && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isRetry ? "Retrying..." : "Deploying..."}
            </Button>
          )}

          {step === "done" && (
            <>
              <div className="flex-1 text-xs">
                {successSpaces > 0 && (
                  <span className="text-green-600 mr-3">
                    {successSpaces} space{successSpaces !== 1 ? "s" : ""} deployed
                  </span>
                )}
                {failedSpaces > 0 && (
                  <span className="text-destructive mr-3">
                    {failedSpaces} space{failedSpaces !== 1 ? "s" : ""} failed
                  </span>
                )}
                {successAssets > 0 && (
                  <span className="text-green-600 mr-3">
                    {successAssets} asset{successAssets !== 1 ? "s" : ""} created
                  </span>
                )}
                {failedAssets > 0 && (
                  <span className="text-destructive">
                    {failedAssets} asset{failedAssets !== 1 ? "s" : ""} failed
                  </span>
                )}
              </div>
              {(failedAssets > 0 || failedSpaces > 0) && (
                <Button variant="outline" onClick={retryFailed}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Retry Failed
                </Button>
              )}
              <Button
                onClick={() => {
                  onComplete();
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step indicator chip
// ---------------------------------------------------------------------------

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        active
          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          : done
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Select Assets
// ---------------------------------------------------------------------------

function SelectAssetsStep({
  assetsByDomain,
  selectedAssets,
  toggleAsset,
  toggleAll,
  allAssets,
  hasAssets,
}: {
  assetsByDomain: Map<string, DeployableAsset[]>;
  selectedAssets: Set<string>;
  toggleAsset: (id: string) => void;
  toggleAll: () => void;
  allAssets: DeployableAsset[];
  hasAssets: boolean;
}) {
  if (!hasAssets) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Layers className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No metric views available to deploy.</p>
        <p className="text-xs text-muted-foreground mt-1">
          The Genie spaces will be created without additional assets.
        </p>
      </div>
    );
  }

  const eligible = allAssets.filter((a) => !a.hasError);
  const allChecked = eligible.length > 0 && eligible.every((a) => selectedAssets.has(a.id));

  return (
    <div className="space-y-3 py-2">
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-2 mx-1">
        <div className="flex gap-2">
          <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            Any metric views referenced by Genie spaces will be automatically deployed if missing.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
          <span className="text-xs font-medium">Select All</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {selectedAssets.size} of {eligible.length} selected
        </span>
      </div>

      {Array.from(assetsByDomain.entries()).map(([domain, assets]) => (
        <div key={domain} className="rounded-md border">
          <div className="bg-muted/30 px-3 py-1.5 text-xs font-medium">{domain}</div>
          <div className="divide-y">
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  checked={selectedAssets.has(asset.id)}
                  onCheckedChange={() => toggleAsset(asset.id)}
                  disabled={asset.hasError}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono truncate" title={asset.name}>
                      {asset.name}
                    </code>
                    <Badge
                      variant="outline"
                      className={`text-[9px] shrink-0 ${
                        asset.type === "metric_view"
                          ? "border-violet-500/50 text-violet-600"
                          : "border-blue-500/50 text-blue-600"
                      }`}
                    >
                      {asset.type === "metric_view" ? "Metric View" : "Function"}
                    </Badge>
                    {asset.classification && (
                      <Badge
                        variant="outline"
                        className={`text-[9px] shrink-0 ${
                          asset.classification === "reuse"
                            ? "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                            : asset.classification === "improve"
                              ? "border-amber-500/50 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
                              : "border-sky-500/50 text-sky-600 bg-sky-50 dark:bg-sky-950/30"
                        }`}
                      >
                        {asset.classification === "reuse"
                          ? "Reuse Existing"
                          : asset.classification === "improve"
                            ? "Improve Existing"
                            : "New"}
                      </Badge>
                    )}
                    {asset.subdomain && (
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {asset.subdomain}
                      </span>
                    )}
                    {asset.hasError && (
                      <Badge variant="destructive" className="text-[9px] shrink-0">
                        <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                        Validation Error
                      </Badge>
                    )}
                  </div>
                  {asset.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {asset.description}
                    </p>
                  )}
                  {asset.rationale && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-1 italic">
                      {asset.rationale}
                    </p>
                  )}
                  {asset.existingFqn && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      Existing: <code className="font-mono">{asset.existingFqn}</code>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Schema picker
// ---------------------------------------------------------------------------

function SchemaStep({
  targetSchema,
  onSchemaChange,
  defaultSchema,
}: {
  targetSchema: string[];
  onSchemaChange: (sources: string[], excluded: string[], patterns: string[]) => void;
  defaultSchema: string;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="px-1">
        <p className="text-xs text-muted-foreground">
          Choose the target schema where metric views will be created. The Genie space will
          reference these assets from this schema.
        </p>
        {targetSchema.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-sm font-medium text-violet-700 dark:text-violet-400">
              {targetSchema[0]}
            </span>
          </div>
        )}
      </div>

      <CatalogBrowser
        selectedSources={targetSchema}
        onSelectionChange={onSchemaChange}
        selectionMode="schema"
        defaultExpandPath={defaultSchema}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Deploy progress + results
// ---------------------------------------------------------------------------

function DeployStep({
  deployLog,
  results,
  step,
  logEndRef,
}: {
  deployLog: string[];
  results: DomainResult[];
  step: Step;
  logEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="space-y-3 py-2">
      {/* Log output */}
      <div className="rounded-md border bg-muted/20 p-3 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
        {deployLog.map((line, i) => (
          <div
            key={i}
            className={
              line.includes("ERROR") || line.includes("FAILED")
                ? "text-destructive"
                : line.includes("deployed") ||
                    line.includes("created") ||
                    line.includes("auto-fixed")
                  ? "text-green-600"
                  : line.includes("Stripped") || line.includes("Retry")
                    ? "text-amber-600"
                    : "text-muted-foreground"
            }
          >
            {line}
          </div>
        ))}
        {step === "deploying" && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing...
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {/* Results summary */}
      {step === "done" && results.length > 0 && (
        <div className="space-y-2">
          {results.map((dr) => {
            const hasFailedAssets = dr.assets.some((a) => !a.success);
            const hasStripped = dr.strippedRefs && dr.strippedRefs.length > 0;
            const isDegraded = hasFailedAssets || hasStripped;

            return (
              <div key={dr.domain} className="rounded-md border p-3">
                <div className="flex items-center gap-2 mb-2">
                  {dr.spaceId && !isDegraded ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : dr.spaceId && isDegraded ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-medium">{dr.domain}</span>
                  {dr.spaceId && !isDegraded && (
                    <Badge className="bg-green-500/10 text-green-600 text-[9px]">Deployed</Badge>
                  )}
                  {dr.spaceId && isDegraded && (
                    <Badge className="bg-amber-500/10 text-amber-600 text-[9px]">
                      Deployed (partial)
                    </Badge>
                  )}
                  {dr.spaceError && (
                    <Badge variant="destructive" className="text-[9px]">
                      Failed
                    </Badge>
                  )}
                </div>

                {dr.assets.length > 0 && (
                  <div className="space-y-1 ml-6">
                    {dr.assets.map((ar, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {ar.success ? (
                          <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3 w-3 text-destructive shrink-0" />
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[8px] shrink-0 ${
                            ar.type === "metric_view"
                              ? "border-violet-500/50 text-violet-600"
                              : "border-blue-500/50 text-blue-600"
                          }`}
                        >
                          {ar.type === "metric_view" ? "MV" : "Fn"}
                        </Badge>
                        <span className="font-mono truncate" title={ar.name}>
                          {ar.name}
                        </span>
                        {ar.autoFixed && (
                          <Badge
                            variant="outline"
                            className="text-[8px] shrink-0 border-amber-500/50 text-amber-600"
                          >
                            auto-fixed
                          </Badge>
                        )}
                        {ar.error && (
                          <span className="text-[10px] text-destructive truncate" title={ar.error}>
                            {ar.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {hasStripped && (
                  <div className="mt-2 ml-6 space-y-1">
                    {dr.strippedRefs!.map((sr, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-amber-600">
                        <Info className="h-3 w-3 shrink-0" />
                        <span
                          className="truncate"
                          title={`Removed metric view ${sr.identifier} — ${sr.reason}`}
                        >
                          Removed metric view{" "}
                          <code className="font-mono text-[10px]">{sr.identifier}</code> &mdash;{" "}
                          {sr.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {dr.spaceError && (
                  <p className="text-[10px] text-destructive mt-1 ml-6">{dr.spaceError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
