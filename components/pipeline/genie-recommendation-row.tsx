"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BrainCircuit } from "lucide-react";
import type { GenieEngineRecommendation, TrackedGenieSpace } from "@/lib/genie/types";
import { ExternalLinkIcon, TrashIcon } from "./genie-spaces-icons";
import { KSChip } from "./genie-spaces-stats";

export interface DeployStatus {
  allowed: boolean;
  warn: boolean;
  reason?: string;
}

interface GenieRecommendationRowProps {
  rec: GenieEngineRecommendation;
  tracking: TrackedGenieSpace | undefined;
  deployed: boolean;
  noTables: boolean;
  deployStatus: DeployStatus;
  selected: boolean;
  trashingDomain: string | null;
  engineGenerating: boolean;
  engineEnabled: boolean;
  completedDomainNames: string[];
  isV1Domain: (rec: GenieEngineRecommendation) => boolean;
  genieSpaceUrl: (spaceId: string) => string | null;
  onToggleSelect: (domain: string) => void;
  onOpenDetail: (domain: string) => void;
  onOpenTrashDialog: (domain: string) => void;
}

export function GenieRecommendationRow({
  rec,
  tracking,
  deployed,
  noTables,
  deployStatus,
  selected,
  trashingDomain,
  engineGenerating,
  engineEnabled,
  completedDomainNames,
  isV1Domain,
  genieSpaceUrl,
  onToggleSelect,
  onOpenDetail,
  onOpenTrashDialog,
}: GenieRecommendationRowProps) {
  return (
    <tr
      className="cursor-pointer border-b transition-colors hover:bg-muted/30"
      onClick={() => onOpenDetail(rec.domain)}
    >
      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(rec.domain)}
          disabled={deployed || noTables || !deployStatus.allowed}
          aria-label={`Select ${rec.domain}`}
        />
      </td>
      <td className="px-3 py-2.5 font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate min-w-0" title={rec.domain}>
            {rec.domain}
          </span>
          {engineGenerating && completedDomainNames.includes(rec.domain) && (
            <BrainCircuit
              className="h-3.5 w-3.5 text-violet-500"
              aria-label="AI analysis complete"
            />
          )}
          {engineGenerating && !completedDomainNames.includes(rec.domain) && isV1Domain(rec) && (
            <BrainCircuit
              className="h-3.5 w-3.5 animate-pulse text-violet-400/50"
              aria-label="AI analysis in progress"
            />
          )}
          {!engineGenerating && !isV1Domain(rec) && (
            <BrainCircuit className="h-3.5 w-3.5 text-violet-500" aria-label="AI enriched" />
          )}
          {!engineGenerating && engineEnabled && isV1Domain(rec) && (
            <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-600">
              Basic
            </Badge>
          )}
          {rec.recommendationType === "enhancement" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[9px] border-sky-400 text-sky-600 cursor-help"
                >
                  Improves existing
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px]">
                Enriches an existing Genie space. Deploying creates a new space &mdash; your
                original is untouched.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </td>
      <td className="max-w-[200px] px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {rec.subdomains.slice(0, 3).map((sd) => (
            <Badge key={sd} variant="outline" className="max-w-full text-[10px]" title={sd}>
              {sd}
            </Badge>
          ))}
          {rec.subdomains.length > 3 && (
            <Badge variant="outline" className="text-[10px]">
              +{rec.subdomains.length - 3}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {noTables ? (
          <Badge variant="destructive" className="text-[10px]">
            No Tables
          </Badge>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
            <KSChip label="Tables" value={rec.tableCount} />
            <KSChip label="Metric Views" value={rec.metricViewCount} accent="violet" />
            <KSChip label="Use Cases" value={rec.useCaseCount} />
            <KSChip label="SQL" value={rec.sqlExampleCount} />
            <KSChip label="Measures" value={rec.measureCount} accent="blue" />
            <KSChip label="Filters" value={rec.filterCount} accent="amber" />
            <KSChip label="Dimensions" value={rec.dimensionCount} accent="emerald" />
            <KSChip label="Joins" value={rec.joinCount} />
            <KSChip label="Benchmarks" value={rec.benchmarkCount} accent="violet" />
            <KSChip label="Instructions" value={rec.instructionCount} />
            <KSChip label="Questions" value={rec.sampleQuestionCount} />
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        {deployed ? (
          <div className="flex items-center justify-center gap-1.5">
            <Badge className="bg-green-500/10 text-green-600">
              {tracking?.status === "updated" ? "Updated" : "Deployed"}
            </Badge>
            {tracking && genieSpaceUrl(tracking.spaceId) && (
              <a
                href={genieSpaceUrl(tracking.spaceId)!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10"
                title="Open in Databricks"
              >
                Open
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <Badge variant="secondary">Not Deployed</Badge>
        )}
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {deployed && (
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            disabled={trashingDomain === rec.domain}
            aria-label={`Trash ${rec.domain} space`}
            onClick={() => onOpenTrashDialog(rec.domain)}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}
