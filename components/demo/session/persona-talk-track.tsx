"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  User,
  MessageSquare,
  Shield,
  Quote as QuoteIcon,
  HelpCircle,
  Target,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type {
  ResearchEngineResult,
  PersonaTalkTrack as PersonaTalkTrackType,
  Evidence,
} from "@/lib/demo/research-engine/types";

interface PersonaTalkTrackProps {
  research: ResearchEngineResult;
}

function evidenceBadgeClass(tier: Evidence["tier"]): string {
  if (tier === "sourced") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (tier === "benchmark") return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
}

function EvidenceChip({ evidence }: { evidence: Evidence }) {
  const label = evidence.tier === "sourced" ? "Sourced" : evidence.tier === "benchmark" ? "Benchmark" : "Inferred";
  const tooltip =
    evidence.tier === "sourced"
      ? evidence.quote ?? evidence.claim ?? ""
      : evidence.tier === "benchmark"
        ? `${evidence.benchmarkLabel ?? ""} ${evidence.benchmarkRange ?? ""}`.trim()
        : evidence.rationale ?? evidence.claim ?? "";

  const chip = (
    <Badge variant="outline" className={`text-[10px] gap-1 ${evidenceBadgeClass(evidence.tier)}`}>
      {evidence.tier === "sourced" && <QuoteIcon className="h-2.5 w-2.5" />}
      {label}
      {evidence.sourceUrl && <ExternalLink className="h-2.5 w-2.5" />}
    </Badge>
  );

  if (evidence.sourceUrl) {
    return (
      <a
        href={evidence.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className="inline-flex hover:opacity-80 transition-opacity"
      >
        {chip}
      </a>
    );
  }
  return <span title={tooltip}>{chip}</span>;
}

export function PersonaTalkTrack({ research }: PersonaTalkTrackProps) {
  const personas = research.personaTalkTracks ?? [];
  const [activePersona, setActivePersona] = useState(personas[0]?.personaId ?? "");

  if (personas.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Persona talk tracks are generated on the Balanced and Full research presets.
      </div>
    );
  }

  const persona: PersonaTalkTrackType | undefined =
    personas.find((p) => p.personaId === activePersona) ?? personas[0];

  if (!persona) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {personas.map((p) => (
          <button
            key={p.personaId}
            onClick={() => setActivePersona(p.personaId)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              (activePersona || personas[0]?.personaId) === p.personaId
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
          >
            <User className="h-3 w-3" />
            {p.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4 text-muted-foreground" />
            {persona.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                What they care about
              </span>
            </div>
            <ul className="space-y-1">
              {persona.caresAbout.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {persona.provocativeOpening && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Provocative opening
                </span>
              </div>
              <div className="rounded-lg border-l-2 border-l-violet-500 bg-violet-500/[0.03] px-3.5 py-2.5">
                <p className="text-sm leading-relaxed italic">{persona.provocativeOpening}</p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                What to say
              </span>
            </div>
            <div className="rounded-lg border-l-2 border-l-blue-500 bg-blue-500/[0.03] px-3.5 py-2.5">
              <p className="text-sm leading-relaxed italic">{persona.whatToSay}</p>
            </div>
          </div>

          {persona.threeObjections && persona.threeObjections.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Expect these objections
                </span>
              </div>
              <div className="space-y-3">
                {persona.threeObjections.map((o, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-1.5">
                    <p className="text-sm font-medium">&ldquo;{o.objection}&rdquo;</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold">Response.</span> {o.response}
                    </p>
                    {o.proofToUse && (
                      <div className="flex items-center gap-1 pt-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                          Proof:
                        </span>
                        <EvidenceChip evidence={o.proofToUse} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {persona.discoveryTrack && persona.discoveryTrack.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <HelpCircle className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Discovery ladder
                </span>
              </div>
              <ol className="space-y-1.5">
                {persona.discoveryTrack.map((q, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="text-primary font-mono text-xs mt-0.5">{i + 1}.</span>
                    <span className="italic">{q}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {persona.closeSignal && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Close signal
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{persona.closeSignal}</p>
            </div>
          )}

          {persona.evidence && persona.evidence.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Evidence
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {persona.evidence.map((e, i) => (
                  <EvidenceChip key={i} evidence={e} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
