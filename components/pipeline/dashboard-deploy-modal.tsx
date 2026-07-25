"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, XCircle, Loader2, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import type { DashboardRecommendation } from "@/lib/dashboard/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "configure" | "deploying" | "done";

interface DomainResult {
  domain: string;
  dashboardId?: string;
  dashboardUrl?: string;
  action?: string;
  publicationStatus?: "draft" | "published" | "publish_failed";
  error?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DashboardDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  recommendations: DashboardRecommendation[];
  databricksHost: string | null;
  onDeployComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardDeployModal({
  open,
  onOpenChange,
  runId,
  recommendations,
  onDeployComplete,
}: DashboardDeployModalProps) {
  const [step, setStep] = useState<Step>("configure");
  const [publishAfterDeploy, setPublishAfterDeploy] = useState(false);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [deployingDomain, setDeployingDomain] = useState<string | null>(null);

  function handleClose() {
    const wasCompleted = step === "done";
    setStep("configure");
    setResults([]);
    setDeployingDomain(null);
    onOpenChange(false);
    if (wasCompleted) {
      onDeployComplete();
    }
  }

  async function deployDomains(
    targetRecommendations: DashboardRecommendation[],
    preservedResults: DomainResult[],
  ) {
    setStep("deploying");
    setResults(preservedResults);
    let deployResults = [...preservedResults];

    for (const rec of targetRecommendations) {
      setDeployingDomain(rec.domain);
      let nextResult: DomainResult;

      try {
        const res = await fetch(
          `/api/runs/${runId}/dashboard-engine/${encodeURIComponent(rec.domain)}/deploy`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              publish: publishAfterDeploy,
            }),
          },
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          nextResult = {
            domain: rec.domain,
            dashboardId: data.dashboardId,
            dashboardUrl: data.dashboardUrl,
            action: data.action,
            publicationStatus: data.publicationStatus,
            error: data.error ?? `HTTP ${res.status}`,
          };
        } else {
          nextResult = {
            domain: rec.domain,
            dashboardId: data.dashboardId,
            dashboardUrl: data.dashboardUrl,
            action: data.action,
            publicationStatus: data.publicationStatus,
          };
        }
      } catch (err) {
        nextResult = {
          domain: rec.domain,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }

      deployResults = [
        ...deployResults.filter((result) => result.domain !== rec.domain),
        nextResult,
      ];
      setResults([...deployResults]);
    }

    setDeployingDomain(null);
    setStep("done");

    const successCount = deployResults.filter((r) => !r.error).length;
    if (successCount === recommendations.length) {
      toast.success(`${successCount} dashboard${successCount !== 1 ? "s" : ""} deployed`);
    } else {
      toast.warning(`${successCount}/${recommendations.length} dashboards deployed`);
    }
  }

  async function handleDeploy() {
    await deployDomains(recommendations, []);
  }

  async function handleRetryFailed() {
    const failedDomains = new Set(
      results.filter((result) => result.error).map((result) => result.domain),
    );
    const retryRecommendations = recommendations.filter((rec) => failedDomains.has(rec.domain));
    const preservedResults = results.filter((result) => !failedDomains.has(result.domain));
    await deployDomains(retryRecommendations, preservedResults);
  }

  const successCount = results.filter((r) => !r.error).length;
  const failCount = results.filter((r) => r.error).length;

  return (
    <Dialog open={open} onOpenChange={step === "deploying" ? undefined : handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5" />
            Deploy Dashboard{recommendations.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            {recommendations.length === 1
              ? `Deploy "${recommendations[0].title}" to your Databricks workspace`
              : `Deploy ${recommendations.length} dashboards to your Databricks workspace`}
          </DialogDescription>
        </DialogHeader>

        {step === "configure" && (
          <div className="space-y-4 py-4">
            {/* Domains to deploy */}
            <div>
              <Label className="text-sm font-medium">Dashboards</Label>
              <div className="mt-2 space-y-1">
                {recommendations.map((rec) => (
                  <div key={rec.domain} className="flex items-center gap-2 py-1">
                    <Badge variant="outline" className="text-xs">
                      {rec.datasetCount} datasets
                    </Badge>
                    <span className="text-sm">{rec.title}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="flex items-center space-x-2">
              <Checkbox
                id="publish"
                checked={publishAfterDeploy}
                onCheckedChange={(checked) => setPublishAfterDeploy(checked === true)}
              />
              <Label htmlFor="publish" className="text-sm cursor-pointer">
                Publish dashboards immediately (makes them viewable by others)
              </Label>
            </div>
          </div>
        )}

        {step === "deploying" && (
          <div className="py-6 space-y-3">
            {recommendations.map((rec) => {
              const result = results.find((r) => r.domain === rec.domain);
              const isCurrent = rec.domain === deployingDomain && !result;

              return (
                <div key={rec.domain} className="flex items-center gap-3 py-1">
                  {result?.error ? (
                    <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : result ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border shrink-0" />
                  )}
                  <span className="text-sm">{rec.title}</span>
                  {result?.error && (
                    <span className="text-xs text-red-500 ml-auto">{result.error}</span>
                  )}
                  {result?.action && (
                    <Badge variant="outline" className="text-xs ml-auto">
                      {result.action}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === "done" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3 justify-center">
              {failCount === 0 ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : (
                <XCircle className="h-8 w-8 text-amber-500" />
              )}
              <div className="text-center">
                <div className="text-lg font-semibold">
                  {successCount} of {results.length} deployed
                </div>
                {failCount > 0 && <div className="text-sm text-red-500">{failCount} failed</div>}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              {results.map((result) => (
                <div key={result.domain} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{result.domain}</span>
                    {result.publicationStatus && (
                      <Badge variant="outline">{result.publicationStatus}</Badge>
                    )}
                  </div>
                  {result.error && <p className="mt-1 text-xs text-red-500">{result.error}</p>}
                  {result.dashboardId && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Draft ID: {result.dashboardId}
                    </p>
                  )}
                  {result.dashboardUrl && (
                    <a
                      href={result.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-2 text-sm text-blue-500 hover:underline"
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Open {result.domain}{" "}
                      {result.publicationStatus === "publish_failed" ? "draft" : "dashboard"}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "configure" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleDeploy}>
                Deploy {recommendations.length} Dashboard
                {recommendations.length !== 1 ? "s" : ""}
              </Button>
            </>
          )}
          {step === "deploying" && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Deploying...
            </Button>
          )}
          {step === "done" && (
            <>
              {failCount > 0 && (
                <Button variant="outline" onClick={handleRetryFailed}>
                  Retry failed
                </Button>
              )}
              <Button onClick={handleClose}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
