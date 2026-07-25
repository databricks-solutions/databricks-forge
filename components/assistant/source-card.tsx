"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table2,
  Lightbulb,
  Sparkles,
  ShieldAlert,
  FileText,
  Database,
  GitBranch,
  Heart,
  BarChart3,
  MessageSquare,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import * as React from "react";

interface SourceCardProps {
  index: number;
  label: string;
  kind: string;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  table_detail: <Table2 className="size-3.5 text-blue-500" />,
  column_profile: <Database className="size-3.5 text-indigo-500" />,
  use_case: <Lightbulb className="size-3.5 text-amber-500" />,
  business_context: <BarChart3 className="size-3.5 text-green-500" />,
  genie_recommendation: <Sparkles className="size-3.5 text-purple-500" />,
  genie_question: <MessageSquare className="size-3.5 text-purple-400" />,
  environment_insight: <ShieldAlert className="size-3.5 text-orange-500" />,
  table_health: <Heart className="size-3.5 text-red-500" />,
  data_product: <Database className="size-3.5 text-teal-500" />,
  outcome_map: <FileText className="size-3.5 text-cyan-500" />,
  lineage_context: <GitBranch className="size-3.5 text-gray-500" />,
  document_chunk: <FileText className="size-3.5 text-gray-400" />,
  fabric_dataset: <ExternalLink className="size-3.5 text-yellow-600" />,
  fabric_measure: <ExternalLink className="size-3.5 text-yellow-600" />,
  fabric_report: <ExternalLink className="size-3.5 text-yellow-600" />,
  fabric_artifact: <ExternalLink className="size-3.5 text-yellow-600" />,
};

const PROVENANCE_STYLE: Record<string, string> = {
  platform: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  insight: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  generated: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  uploaded: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
  template: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  off_platform: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

function getProvenance(kind: string): string {
  switch (kind) {
    case "table_detail":
    case "column_profile":
    case "table_health":
    case "lineage_context":
      return "platform";
    case "environment_insight":
    case "data_product":
      return "insight";
    case "use_case":
    case "business_context":
    case "genie_recommendation":
    case "genie_question":
      return "generated";
    case "document_chunk":
      return "uploaded";
    case "outcome_map":
      return "template";
    case "fabric_dataset":
    case "fabric_measure":
    case "fabric_report":
    case "fabric_artifact":
      return "off_platform";
    default:
      return "generated";
  }
}

function getProvenanceLabel(prov: string): string {
  const labels: Record<string, string> = {
    platform: "Platform",
    insight: "Insight",
    generated: "Generated",
    uploaded: "Uploaded",
    template: "Template",
    off_platform: "Power BI",
  };
  return labels[prov] ?? "Source";
}

export function SourceCard({ index, label, kind, sourceId, score, metadata }: SourceCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const prov = getProvenance(kind);
  const icon = KIND_ICON[kind] ?? <FileText className="size-3.5" />;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex w-full items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60"
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="truncate font-medium">{sourceId}</span>
          <Badge
            variant="outline"
            className={`shrink-0 px-1 py-0 text-[9px] leading-tight ${PROVENANCE_STYLE[prov] ?? ""}`}
          >
            {getProvenanceLabel(prov)}
          </Badge>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {(score * 100).toFixed(0)}%
          </span>
          <ChevronDown
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
        {expanded && (
          <div className="mt-1.5 space-y-1 text-muted-foreground">
            <p className="break-words">{label}</p>
            {metadata && Object.keys(metadata).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(metadata)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-[9px]">
                      {k}: {String(v).slice(0, 40)}
                    </Badge>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export function SourceCardList({ sources }: { sources: SourceCardProps[] }) {
  const [showAll, setShowAll] = React.useState(false);
  if (sources.length === 0) return null;

  const displayed = showAll ? sources : sources.slice(0, 3);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Sources</p>
      {displayed.map((s) => (
        <SourceCard key={s.index} {...s} />
      ))}
      {sources.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? "Show less" : `Show all ${sources.length} sources`}
        </button>
      )}
    </div>
  );
}
