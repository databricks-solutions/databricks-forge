"use client";

import * as React from "react";
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
import { LayoutDashboard, Rocket, Loader2, Check, AlertCircle, ExternalLink } from "lucide-react";

export interface DashboardDeployPayload {
  proposal?: {
    title?: string;
    description?: string;
    tables?: string[];
    widgetDescriptions?: string[];
  };
  sqlBlocks?: string[];
  conversationSummary?: string;
  domainHint?: string;
}

interface DeployDashboardDialogProps {
  open: boolean;
  payload: DashboardDeployPayload | null;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "generating" | "done" | "error";

export function DeployDashboardDialog({ open, payload, onOpenChange }: DeployDashboardDialogProps) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [result, setResult] = React.useState<{
    dashboardUrl?: string;
    title?: string;
    datasetCount?: number;
    widgetCount?: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPhase("idle");
      setResult(null);
      setError(null);
    }
  }, [open]);

  const proposal = payload?.proposal;
  const title = proposal?.title ?? "Forge Dashboard";
  const tables = proposal?.tables ?? [];
  const widgets = proposal?.widgetDescriptions ?? [];
  const sqlBlocks = payload?.sqlBlocks ?? [];

  const handleDeploy = async () => {
    setPhase("generating");
    setError(null);
    setResult(null);

    try {
      const resp = await fetch("/api/dashboard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tables,
          sqlBlocks,
          conversationSummary: payload?.conversationSummary,
          widgetDescriptions: widgets,
          domainHint: payload?.domainHint,
          title,
          deploy: true,
          publish: true,
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        setPhase("error");
        setError(data.error ?? "Dashboard generation failed");
        return;
      }

      setResult({
        dashboardUrl: data.dashboardUrl,
        title: data.recommendation?.title,
        datasetCount: data.recommendation?.datasetCount,
        widgetCount: data.recommendation?.widgetCount,
      });
      setPhase("done");
    } catch {
      setPhase("error");
      setError("Network error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-primary" />
            Deploy as Dashboard
          </DialogTitle>
          <DialogDescription>
            Forge will design a Lakeview dashboard from the referenced tables and deploy it to your
            Databricks workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {phase === "idle" && (
            <>
              <div>
                <p className="text-sm font-medium">{title}</p>
                {proposal?.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{proposal.description}</p>
                )}
              </div>

              {tables.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Referenced Tables
                  </p>
                  <div className="flex max-h-[100px] flex-wrap gap-1.5 overflow-y-auto">
                    {tables.map((t) => (
                      <Badge key={t} variant="outline" className="shrink-0 text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {widgets.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Proposed Widgets
                  </p>
                  <ul className="space-y-1">
                    {widgets.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <LayoutDashboard className="mt-0.5 size-3 shrink-0 text-primary" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sqlBlocks.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">SQL Context</p>
                  <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                    <code>{sqlBlocks[0]}</code>
                  </pre>
                  {sqlBlocks.length > 1 && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      +{sqlBlocks.length - 1} more quer{sqlBlocks.length === 2 ? "y" : "ies"}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {phase === "generating" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Designing and deploying dashboard...</p>
              <p className="text-xs text-muted-foreground">This typically takes 10-20 seconds.</p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="size-4" />
                Dashboard deployed successfully
              </div>
              {result.title && <p className="text-sm font-medium">{result.title}</p>}
              {(result.datasetCount || result.widgetCount) && (
                <p className="text-xs text-muted-foreground">
                  {result.datasetCount} dataset{result.datasetCount !== 1 ? "s" : ""},{" "}
                  {result.widgetCount} widget{result.widgetCount !== 1 ? "s" : ""}
                </p>
              )}
              {result.dashboardUrl && (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3.5" />
                    Open in Databricks
                  </a>
                </Button>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="flex items-center gap-2 py-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {phase === "idle" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} className="gap-1.5" disabled={tables.length === 0}>
                <Rocket className="size-3.5" />
                Deploy Dashboard
              </Button>
            </>
          )}
          {phase === "generating" && (
            <Button variant="outline" disabled>
              Generating...
            </Button>
          )}
          {(phase === "done" || phase === "error") && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
