"use client";

import { Badge } from "@/components/ui/badge";
import { Layers, BookText, Tag, Sparkles } from "lucide-react";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";

interface SchemaReviewStepProps {
  research: ResearchEngineResult;
}

export function SchemaReviewStep({ research }: SchemaReviewStepProps) {
  const nomenclatureEntries = Object.entries(research.nomenclature ?? {});
  const killerMoments = research.demoNarrative?.killerMoments?.slice(0, 3) ?? [];

  return (
    <div className="space-y-5 px-1">
      {/* Data Assets */}
      <section>
        <SectionHeader icon={Layers} title="Data Assets" subtitle={`${research.matchedDataAssetIds.length} matched`} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {research.matchedDataAssetIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] font-medium tracking-tight"
            >
              {id}
            </span>
          ))}
        </div>
      </section>

      {/* Data Narratives */}
      {research.dataNarratives.length > 0 && (
        <section>
          <SectionHeader icon={BookText} title="Data Narratives" subtitle="Patterns embedded in generated data" />
          <div className="mt-2.5 space-y-2">
            {research.dataNarratives.map((n, i) => (
              <div key={i} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{n.title}</p>
                  <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">{n.pattern}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{n.description}</p>
                {n.affectedTables.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {n.affectedTables.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Nomenclature */}
      {nomenclatureEntries.length > 0 && (
        <section>
          <SectionHeader icon={Tag} title="Nomenclature" subtitle="Company terms used in tables" />
          <div className="mt-2 rounded-lg border bg-card">
            <div className="grid grid-cols-2 divide-x">
              {[0, 1].map((col) => (
                <div key={col} className="divide-y">
                  {nomenclatureEntries
                    .filter((_, i) => i % 2 === col)
                    .map(([key, val]) => (
                      <div key={key} className="flex items-baseline gap-2 px-3 py-1.5 text-xs">
                        <span className="shrink-0 font-semibold">{key}</span>
                        <span className="truncate text-muted-foreground">{val}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Demo Highlights */}
      {killerMoments.length > 0 && (
        <section>
          <SectionHeader icon={Sparkles} title="Demo Highlights" subtitle="Key moments to showcase" />
          <div className="mt-2.5 space-y-2">
            {killerMoments.map((m, i) => (
              <div
                key={i}
                className="relative rounded-lg border border-primary/15 bg-primary/[0.02] p-3 pl-4"
              >
                <div className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
                <p className="text-sm font-semibold">{m.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{m.scenario}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </div>
  );
}
