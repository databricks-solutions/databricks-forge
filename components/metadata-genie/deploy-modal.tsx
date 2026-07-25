"use client";

/**
 * Deploy modal for the Meta Data Genie.
 *
 * Three steps:
 * 1. Schema -- pick target catalog.schema via CatalogBrowser
 * 2. Deploying -- spinner while views + space are created
 * 3. Done -- deep link to the Genie Space
 */

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
import { CheckCircle2, Loader2, Rocket, ExternalLink } from "lucide-react";
import { loadSettings } from "@/lib/settings";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";

type Step = "schema" | "deploying" | "done";

interface DeployResult {
  spaceId: string;
  spaceUrl: string;
}

interface MetadataGenieDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  spaceTitle: string;
  onComplete: (result: DeployResult) => void;
}

export function MetadataGenieDeployModal({
  open,
  onOpenChange,
  spaceId,
  spaceTitle,
  onComplete,
}: MetadataGenieDeployModalProps) {
  const [step, setStep] = useState<Step>("schema");
  const [targetSchema, setTargetSchema] = useState<string[]>([]);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleDeploy = useCallback(async () => {
    if (targetSchema.length === 0) return;

    const parts = targetSchema[0].split(".");
    if (parts.length !== 2) return;

    setStep("deploying");
    setError(null);

    try {
      const res = await fetch("/api/metadata-genie/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: spaceId,
          viewTarget: { catalog: parts[0], schema: parts[1] },
          authMode: loadSettings().genieDeployAuthMode,
          resourcePrefix: loadSettings().catalogResourcePrefix,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Deployment failed"));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await safeJsonParse(res);
      if (!data) throw new Error("Invalid response from server");
      const result = {
        spaceId: data.spaceId,
        spaceUrl: data.spaceUrl,
      };
      setDeployResult(result);
      setStep("done");
      onComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
      setStep("schema");
    }
  }, [targetSchema, spaceId, onComplete]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // Reset state for next open
    setTimeout(() => {
      setStep("schema");
      setTargetSchema([]);
      setDeployResult(null);
      setError(null);
    }, 200);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {step === "done" ? "Deployment Complete" : `Deploy ${spaceTitle}`}
          </DialogTitle>
          <DialogDescription>
            {step === "schema" &&
              "Choose a catalog and schema where the 10 curated metadata views will be created. Genie Space consumers will need SELECT access to this schema."}
            {step === "deploying" && "Creating views and deploying the Genie Space..."}
            {step === "done" && "Your Meta Data Genie is ready to use."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Schema selection */}
          {step === "schema" && (
            <div className="space-y-4">
              <div className="rounded-md border">
                <CatalogBrowser
                  selectedSources={targetSchema}
                  onSelectionChange={handleSchemaChange}
                  selectionMode="schema"
                />
              </div>
              {targetSchema.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Views will be created as{" "}
                  <code className="text-xs font-medium">
                    {targetSchema[0]}.{loadSettings().catalogResourcePrefix}mdg_*
                  </code>
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {/* Deploying */}
          {step === "deploying" && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">
                Creating 10 curated views and deploying the Genie Space...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This typically takes 10-15 seconds
              </p>
            </div>
          )}

          {/* Done */}
          {step === "done" && deployResult && (
            <div className="flex flex-col items-center py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="mt-4 text-sm font-medium">{spaceTitle} is live</p>
              <Button asChild className="mt-4">
                <a href={deployResult.spaceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Genie Space
                </a>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "schema" && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} disabled={targetSchema.length === 0}>
                <Rocket className="mr-2 h-4 w-4" />
                Deploy
              </Button>
            </>
          )}
          {step === "done" && (
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
