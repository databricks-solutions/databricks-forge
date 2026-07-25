import { Cpu } from "lucide-react";

interface ProvenanceFooterProps {
  /** Endpoint name that produced the data (e.g. "databricks-claude-opus-4-7"). */
  generatedByModel: string | null;
  /** When the LLM emitted the response. */
  generatedAt: Date | null;
  /** Optional context label rendered before the model name, e.g. "Stakeholder profiles". */
  label?: string;
  /** When true, render the chip in muted form (right-aligned, small footer). */
  muted?: boolean;
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

/**
 * Small footer chip showing which LLM produced the data and when. Closes
 * the trust gap on every BV / Outcome-Map surface so the consumer can
 * distinguish premium Opus 4-7 output from legacy mixed-pool runs.
 *
 * Renders nothing if both `generatedByModel` and `generatedAt` are null
 * (legacy rows from before provenance was added).
 */
export function ProvenanceFooter({
  generatedByModel,
  generatedAt,
  label = "Generated",
  muted = true,
}: ProvenanceFooterProps) {
  if (!generatedByModel && !generatedAt) return null;

  const modelLabel = generatedByModel ?? "(unknown model)";
  const timeLabel = generatedAt
    ? `${formatRelative(generatedAt)} (${generatedAt.toLocaleString()})`
    : null;

  return (
    <div
      className={`flex items-center gap-2 text-[11px] ${
        muted ? "text-muted-foreground" : ""
      }`}
    >
      <Cpu className="h-3 w-3" aria-hidden="true" />
      <span>
        {label} by <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{modelLabel}</code>
        {timeLabel ? <> · {timeLabel}</> : null}
      </span>
    </div>
  );
}
