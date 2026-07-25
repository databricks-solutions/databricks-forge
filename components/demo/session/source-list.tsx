"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { ResearchSource } from "@/lib/demo/types";
import type { SourceSummary } from "@/lib/demo/research-engine/types";
import { isStale, publishedYearOf } from "@/lib/demo/research-engine/recency";

interface SourceListProps {
  sources: ResearchSource[];
  summaries?: SourceSummary[];
}

const statusStyles: Record<string, string> = {
  ready: "bg-emerald-500",
  failed: "bg-red-500",
  pending: "bg-amber-500",
  fetching: "bg-blue-500",
};

function findSummary(
  source: ResearchSource,
  summaries: SourceSummary[] | undefined,
): SourceSummary | undefined {
  if (!summaries || summaries.length === 0) return undefined;
  if (source.url) {
    const byUrl = summaries.find((s) => s.sourceUrl === source.url);
    if (byUrl) return byUrl;
  }
  return summaries.find((s) => s.sourceTitle === source.title);
}

export function SourceList({ sources, summaries }: SourceListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (sources.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No sources collected.
      </div>
    );
  }

  const ready = sources.filter((s) => s.status === "ready");
  const failed = sources.filter((s) => s.status === "failed");
  const other = sources.filter((s) => s.status !== "ready" && s.status !== "failed");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
        <span>{sources.length} total</span>
        <span className="h-3 w-px bg-border" />
        <span className="text-emerald-600 dark:text-emerald-400">{ready.length} ready</span>
        {failed.length > 0 && (
          <>
            <span className="h-3 w-px bg-border" />
            <span className="text-red-600 dark:text-red-400">{failed.length} failed</span>
          </>
        )}
        {other.length > 0 && (
          <>
            <span className="h-3 w-px bg-border" />
            <span>{other.length} pending</span>
          </>
        )}
        {summaries && summaries.length > 0 && (
          <>
            <span className="h-3 w-px bg-border" />
            <span className="text-primary">{summaries.length} summarised</span>
          </>
        )}
      </div>

      <div className="divide-y rounded-lg border">
        {sources.map((s, i) => {
          const linkUrl = s.url ?? (s.title?.startsWith("http") ? s.title : undefined);
          const label = s.url && s.title !== s.url ? s.title : s.title ?? s.url;
          const summary = findSummary(s, summaries);
          const isOpen = openIndex === i;

          return (
            <div key={i} className="text-sm">
              <div className="flex items-center gap-3 px-3.5 py-2.5">
                {summary ? (
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-label={isOpen ? "Collapse summary" : "Expand summary"}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="w-3.5" />
                )}
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusStyles[s.status] ?? statusStyles.pending}`}
                />
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {s.type}
                </Badge>
                {(() => {
                  const year = publishedYearOf(s);
                  if (!year) return null;
                  const stale = isStale(s);
                  return (
                    <Badge
                      variant={stale ? "destructive" : "outline"}
                      className="text-[10px] shrink-0"
                      title={
                        stale
                          ? "More than 3 years old -- prefer newer sources"
                          : undefined
                      }
                    >
                      {stale ? `Stale: ${year}` : year}
                    </Badge>
                  );
                })()}
                <span className="min-w-0 flex-1 truncate">
                  {linkUrl ? (
                    <a
                      href={linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      title={linkUrl}
                    >
                      <span className="truncate">{label}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground truncate">{label}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.charCount.toLocaleString()} chars
                </span>
              </div>

              {summary && isOpen && (
                <div className="px-3.5 pb-3 pl-11 space-y-2 bg-muted/20">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {summary.twoSentenceSummary}
                  </p>
                  {summary.keyTakeaways && summary.keyTakeaways.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                        Key takeaways
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {summary.keyTakeaways.map((t, ti) => (
                          <li key={ti} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="text-primary">•</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
