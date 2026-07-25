"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AlertTriangle, BrainCircuit, Loader2 } from "lucide-react";
import type {
  GenieEngineRecommendation,
  MetricViewProposal,
  SerializedSpace,
  TrackedGenieSpace,
} from "@/lib/genie/types";
import type { UseCase } from "@/lib/domain/types";
import { GenieIcon, ExternalLinkIcon } from "./genie-spaces-icons";
import { StatBadge } from "./genie-spaces-stats";
import { GenieDetailAccordion } from "./genie-detail-accordion";
import type { DeployStatus } from "./genie-recommendation-row";

interface GenieDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rec: GenieEngineRecommendation;
  parsed: SerializedSpace;
  mvProposals: MetricViewProposal[];
  tracking: TrackedGenieSpace | undefined;
  useCases: UseCase[];
  loadingUseCases: boolean;
  testResults: { question: string; status: string; sql?: string; error?: string }[] | null;
  testingDomain: string | null;
  regeneratingDomain: string | null;
  trashingDomain: string | null;
  isV1Domain: (rec: GenieEngineRecommendation) => boolean;
  getDeployStatus: (rec: GenieEngineRecommendation) => DeployStatus;
  genieSpaceUrl: (spaceId: string) => string | null;
  onClose: () => void;
  onRegenerate: (domain: string) => void;
  onTest: (domain: string) => void;
  onOpenTrashDialog: (domain: string) => void;
  onDeploy: (rec: GenieEngineRecommendation) => void;
}

export function GenieDetailSheet({
  open,
  onOpenChange,
  rec,
  parsed,
  mvProposals,
  tracking,
  useCases,
  loadingUseCases,
  testResults,
  testingDomain,
  regeneratingDomain,
  trashingDomain,
  isV1Domain,
  getDeployStatus,
  genieSpaceUrl,
  onClose,
  onRegenerate,
  onTest,
  onOpenTrashDialog,
  onDeploy,
}: GenieDetailSheetProps) {
  const deployStatus = getDeployStatus(rec);

  return (
    <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GenieIcon className="h-5 w-5 text-violet-500" />
            {rec.domain}
            {!isV1Domain(rec) && (
              <BrainCircuit className="h-4 w-4 text-violet-500" aria-label="AI enriched" />
            )}
          </SheetTitle>
          <SheetDescription>{rec.description}</SheetDescription>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {tracking && (
              <Badge className="w-fit bg-green-500/10 text-green-600">
                {tracking.status === "updated" ? "Updated" : "Deployed"}
              </Badge>
            )}
            {rec.recommendationType === "enhancement" && (
              <Badge className="w-fit border-sky-500/30 bg-sky-500/10 text-sky-600">
                Improves existing space
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-5 px-4">
          {rec.recommendationType === "enhancement" && (
            <div className="space-y-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
                Improves an existing Genie space
              </p>
              {rec.changeSummary && (
                <p className="text-xs text-muted-foreground">{rec.changeSummary}</p>
              )}
              <p className="text-[11px] text-sky-700/80 dark:text-sky-400/80">
                Deploying creates a <span className="font-medium">new</span> Genie space. The
                original space will not be modified.
              </p>
              {rec.existingAssetId && genieSpaceUrl(rec.existingAssetId) && (
                <a
                  href={genieSpaceUrl(rec.existingAssetId)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 transition-colors hover:text-sky-700"
                >
                  Open original space
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
          {rec.recommendationType !== "enhancement" && rec.changeSummary && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
                Changes vs Existing
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{rec.changeSummary}</p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
            <StatBadge label="Tables" value={rec.tableCount} />
            <StatBadge label="Metric Views" value={rec.metricViewCount} />
            <StatBadge label="Use Cases" value={rec.useCaseCount} />
            <StatBadge label="SQL Examples" value={rec.sqlExampleCount} />
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
            <StatBadge label="Joins" value={rec.joinCount} />
            <StatBadge label="Measures" value={rec.measureCount} />
            <StatBadge label="Filters" value={rec.filterCount} />
            <StatBadge label="Dimensions" value={rec.dimensionCount} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <StatBadge label="Benchmarks" value={rec.benchmarkCount} />
            <StatBadge label="Instructions" value={rec.instructionCount} />
            <StatBadge label="Questions" value={rec.sampleQuestionCount} />
          </div>

          <Separator />

          <GenieDetailAccordion
            rec={rec}
            parsed={parsed}
            mvProposals={mvProposals}
            useCases={useCases}
            loadingUseCases={loadingUseCases}
          />
        </div>

        {testResults && testResults.length > 0 && (
          <div className="mt-4 space-y-2 px-4">
            <Separator />
            <h4 className="text-xs font-semibold">Test Results</h4>
            {testResults.map((r, i) => (
              <div key={i} className="rounded border p-2">
                <div className="flex items-center gap-2">
                  <Badge
                    className={
                      r.status === "COMPLETED"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-red-500/10 text-red-600"
                    }
                  >
                    {r.status === "COMPLETED" ? "Pass" : "Fail"}
                  </Badge>
                  <span className="text-xs">{r.question}</span>
                </div>
                {r.sql && (
                  <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px]">
                    {r.sql}
                  </pre>
                )}
                {r.error && <p className="mt-1 text-[10px] text-destructive">{r.error}</p>}
              </div>
            ))}
          </div>
        )}

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-col">
          {tracking && genieSpaceUrl(tracking.spaceId) && (
            <>
              <Button asChild className="w-full bg-violet-600 hover:bg-violet-700">
                <a
                  href={genieSpaceUrl(tracking.spaceId)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLinkIcon className="mr-2 h-4 w-4" />
                  Open in Databricks
                </a>
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <a href={`/genie/${tracking.spaceId}`}>View in Genie Studio</a>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onRegenerate(rec.domain)}
            disabled={regeneratingDomain === rec.domain}
          >
            {regeneratingDomain === rec.domain ? "Regenerating..." : "Regenerate Domain"}
          </Button>
          {tracking && (
            <Button
              variant="outline"
              className="w-full flex-1"
              onClick={() => onTest(rec.domain)}
              disabled={testingDomain === rec.domain}
            >
              {testingDomain === rec.domain ? "Testing..." : "Test Space"}
            </Button>
          )}
          {tracking ? (
            <Button
              variant="destructive"
              className="w-full"
              disabled={trashingDomain === rec.domain}
              onClick={() => {
                onClose();
                onOpenTrashDialog(rec.domain);
              }}
            >
              Delete Space
            </Button>
          ) : rec.tableCount === 0 ? (
            <Button className="w-full" variant="secondary" disabled>
              Cannot Deploy — No Tables
            </Button>
          ) : !deployStatus.allowed ? (
            <Button className="w-full" variant="secondary" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {deployStatus.reason}
            </Button>
          ) : (
            <>
              {deployStatus.warn && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {deployStatus.reason}
                  </p>
                </div>
              )}
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => {
                  onClose();
                  onDeploy(rec);
                }}
              >
                Deploy{deployStatus.warn ? " Anyway" : ""}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
