"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  Quote as QuoteIcon,
  BarChart3,
  Lightbulb,
  ExternalLink,
  Filter,
} from "lucide-react";
import type {
  ResearchEngineResult,
  Evidence,
  EvidenceTier,
} from "@/lib/demo/research-engine/types";
import { isStale, publishedYearOf } from "@/lib/demo/research-engine/recency";

interface EvidenceListProps {
  research: ResearchEngineResult;
}

interface EvidenceEntry {
  evidence: Evidence;
  claim: string;
  origin: string;
}

function collectEvidence(research: ResearchEngineResult): EvidenceEntry[] {
  const entries: EvidenceEntry[] = [];

  const brief = research.executiveBrief;
  if (brief?.evidence) {
    for (const e of brief.evidence) {
      entries.push({
        evidence: e,
        claim: e.claim ?? brief.whereWeWin ?? "Executive brief claim",
        origin: "Executive Brief",
      });
    }
  }

  const profile = research.companyProfile;
  if (profile) {
    for (const p of profile.statedPriorities ?? []) {
      if (p.evidence) {
        entries.push({ evidence: p.evidence, claim: p.priority, origin: "Stated priority" });
      }
    }
    for (const p of profile.inferredPriorities ?? []) {
      if (p.evidenceObj) {
        entries.push({ evidence: p.evidenceObj, claim: p.priority, origin: "Inferred priority" });
      }
    }
    for (const g of profile.strategicGaps ?? []) {
      if (g.evidence) {
        entries.push({ evidence: g.evidence, claim: g.gap, origin: "Strategic gap" });
      }
    }
  }

  const moments = research.demoNarrative?.killerMoments ?? [];
  for (const m of moments) {
    for (const e of m.evidence ?? []) {
      entries.push({
        evidence: e,
        claim: e.claim ?? m.title,
        origin: `Opportunity: ${m.title}`,
      });
    }
  }

  for (const t of research.personaTalkTracks ?? []) {
    for (const e of t.evidence ?? []) {
      entries.push({
        evidence: e,
        claim: e.claim ?? t.label,
        origin: `Talk track: ${t.label}`,
      });
    }
    for (const o of t.threeObjections ?? []) {
      if (o.proofToUse) {
        entries.push({
          evidence: o.proofToUse,
          claim: `Response to: "${o.objection}"`,
          origin: `Talk track: ${t.label}`,
        });
      }
    }
  }

  return entries;
}

const tierMeta: Record<EvidenceTier, { label: string; icon: React.ComponentType<{ className?: string }>; badge: string }> = {
  sourced: {
    label: "Sourced",
    icon: QuoteIcon,
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  benchmark: {
    label: "Benchmark",
    icon: BarChart3,
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  },
  inferred: {
    label: "Inferred",
    icon: Lightbulb,
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
};

type TierFilter = EvidenceTier | "all";

export function EvidenceList({ research }: EvidenceListProps) {
  const allEntries = useMemo(() => collectEvidence(research), [research]);
  const [filter, setFilter] = useState<TierFilter>("all");

  const counts = useMemo(
    () => ({
      all: allEntries.length,
      sourced: allEntries.filter((e) => e.evidence.tier === "sourced").length,
      benchmark: allEntries.filter((e) => e.evidence.tier === "benchmark").length,
      inferred: allEntries.filter((e) => e.evidence.tier === "inferred").length,
    }),
    [allEntries],
  );

  const filtered = filter === "all" ? allEntries : allEntries.filter((e) => e.evidence.tier === filter);

  const grouped = useMemo(() => {
    const byTier: Record<EvidenceTier, EvidenceEntry[]> = {
      sourced: [],
      benchmark: [],
      inferred: [],
    };
    for (const entry of filtered) byTier[entry.evidence.tier].push(entry);
    return byTier;
  }, [filtered]);

  if (allEntries.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No structured evidence collected yet. Run a Balanced or Full research preset to produce
        sourced + benchmarked + inferred evidence.
      </div>
    );
  }

  const filterPills: Array<{ id: TierFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "sourced", label: "Sourced", count: counts.sourced },
    { id: "benchmark", label: "Benchmark", count: counts.benchmark },
    { id: "inferred", label: "Inferred", count: counts.inferred },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        {filterPills.map((pill) => (
          <button
            key={pill.id}
            onClick={() => setFilter(pill.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === pill.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {pill.label}
            <span className="text-[10px] opacity-75">({pill.count})</span>
          </button>
        ))}
      </div>

      {(["sourced", "benchmark", "inferred"] as const).map((tier) => {
        const entries = grouped[tier];
        if (entries.length === 0) return null;
        const meta = tierMeta[tier];
        const Icon = meta.icon;

        return (
          <div key={tier} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{meta.label}</h3>
              <Badge variant="outline" className={`text-[10px] ${meta.badge}`}>
                {entries.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {entries.map((entry, i) => (
                <EvidenceRow key={i} entry={entry} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceRow({ entry }: { entry: EvidenceEntry }) {
  const { evidence, claim, origin } = entry;
  const meta = tierMeta[evidence.tier];

  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">{origin}</p>
            <h4 className="mt-0.5 text-sm font-medium leading-snug">{claim}</h4>
          </div>
          <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${meta.badge}`}>
            <ShieldCheck className="mr-1 h-3 w-3" />
            {meta.label}
          </Badge>
        </div>

        {evidence.tier === "sourced" && evidence.quote && (
          <blockquote className="border-l-2 border-emerald-500/40 bg-emerald-500/5 pl-3 py-1.5 text-xs text-muted-foreground italic leading-relaxed">
            &ldquo;{evidence.quote}&rdquo;
          </blockquote>
        )}

        {evidence.tier === "benchmark" && (evidence.benchmarkLabel || evidence.benchmarkRange) && (
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold">{evidence.benchmarkLabel ?? "Benchmark"}.</span>{" "}
            {evidence.benchmarkRange}
          </div>
        )}

        {evidence.tier === "inferred" && evidence.rationale && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold">Rationale.</span> {evidence.rationale}
          </p>
        )}

        {evidence.sourceUrl && (
          <div className="pt-1 flex items-center gap-2 flex-wrap">
            <a
              href={evidence.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline truncate max-w-full"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{evidence.sourceTitle ?? evidence.sourceUrl}</span>
            </a>
            {(() => {
              const year = publishedYearOf({
                publishedAt: evidence.sourcePublishedAt,
                publishedYear: evidence.sourcePublishedYear,
              });
              if (!year) return null;
              const stale = isStale({
                publishedAt: evidence.sourcePublishedAt,
                publishedYear: evidence.sourcePublishedYear,
              });
              return (
                <Badge
                  variant={stale ? "destructive" : "outline"}
                  className="text-[10px] shrink-0"
                  title={
                    stale
                      ? "Source is more than 3 years old -- treat as historical context"
                      : undefined
                  }
                >
                  {stale ? `Stale: ${year}` : year}
                </Badge>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
