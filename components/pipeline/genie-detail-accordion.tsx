"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type {
  GenieEngineRecommendation,
  MetricViewProposal,
  SerializedSpace,
} from "@/lib/genie/types";
import type { UseCase } from "@/lib/domain/types";

interface GenieDetailAccordionProps {
  rec: GenieEngineRecommendation;
  parsed: SerializedSpace;
  mvProposals: MetricViewProposal[];
  useCases: UseCase[];
  loadingUseCases: boolean;
}

export function GenieDetailAccordion({
  rec,
  parsed,
  mvProposals,
  useCases,
  loadingUseCases,
}: GenieDetailAccordionProps) {
  return (
    <Accordion type="multiple" defaultValue={["tables"]} className="w-full">
      {/* Tables & Views */}
      <AccordionItem value="tables">
        <AccordionTrigger className="text-xs font-medium">
          Tables &amp; Views ({rec.tableCount})
        </AccordionTrigger>
        <AccordionContent>
          <div className="max-h-48 space-y-0.5 overflow-auto text-xs">
            {rec.tables.map((t) => (
              <div key={t} className="truncate font-mono text-muted-foreground">
                {t}
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Metric Views — generated for this Genie space */}
      {(rec.metricViews.length > 0 ||
        mvProposals.length > 0 ||
        (parsed.data_sources?.metric_views && parsed.data_sources.metric_views.length > 0)) && (
        <AccordionItem value="metric-views">
          <AccordionTrigger className="text-xs font-medium">
            Metric Views ({rec.metricViewCount})
          </AccordionTrigger>
          <AccordionContent>
            <div className="max-h-80 space-y-2 overflow-auto text-xs">
              <p className="text-[10px] text-muted-foreground mb-2">
                Metric views generated for this Genie space. They will be deployed alongside the
                space.
              </p>
              {mvProposals.length > 0
                ? mvProposals.map((mv, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border p-1.5">
                      <span className="font-mono font-semibold text-violet-500 truncate flex-1">
                        {mv.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          mv.validationStatus === "valid"
                            ? "border-green-500/50 text-green-600 text-[9px]"
                            : mv.validationStatus === "warning"
                              ? "border-amber-500/50 text-amber-600 text-[9px]"
                              : "border-red-500/50 text-red-600 text-[9px]"
                        }
                      >
                        {mv.validationStatus}
                      </Badge>
                    </div>
                  ))
                : parsed.data_sources?.metric_views && parsed.data_sources.metric_views.length > 0
                  ? parsed.data_sources.metric_views.map((mv) => (
                      <div
                        key={mv.identifier}
                        className="flex items-center gap-2 rounded border p-1.5"
                      >
                        <span className="truncate font-mono text-violet-500 flex-1">
                          {mv.identifier}
                        </span>
                      </div>
                    ))
                  : rec.metricViews.map((mv) => (
                      <div key={mv} className="flex items-center gap-2 rounded border p-1.5">
                        <span className="truncate font-mono text-violet-500 flex-1">{mv}</span>
                      </div>
                    ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Use Cases */}
      {rec.useCaseCount > 0 && (
        <AccordionItem value="usecases">
          <AccordionTrigger className="text-xs font-medium">
            Use Cases ({rec.useCaseCount})
          </AccordionTrigger>
          <AccordionContent>
            {loadingUseCases ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : useCases.length > 0 ? (
              <div className="max-h-72 space-y-2 overflow-auto">
                {useCases.map((uc) => (
                  <div key={uc.id} className="space-y-1 rounded border p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{uc.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          uc.type === "AI"
                            ? "border-violet-500/50 text-violet-600 text-[9px]"
                            : uc.type === "Geospatial"
                              ? "border-emerald-500/50 text-emerald-600 text-[9px]"
                              : "border-blue-500/50 text-blue-600 text-[9px]"
                        }
                      >
                        {uc.type}
                      </Badge>
                      <span className="ml-auto text-[10px] font-medium tabular-nums text-muted-foreground">
                        {Math.round(uc.overallScore)}%
                      </span>
                    </div>
                    {uc.statement && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        {uc.statement}
                      </p>
                    )}
                    {uc.tablesInvolved.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {uc.tablesInvolved.map((t) => (
                          <Badge key={t} variant="outline" className="font-mono text-[9px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No use case details available.</p>
            )}
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Sample Questions */}
      {(parsed.config?.sample_questions?.length ?? 0) > 0 && (
        <AccordionItem value="questions">
          <AccordionTrigger className="text-xs font-medium">
            Sample Questions ({parsed.config?.sample_questions?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(parsed.config?.sample_questions ?? []).map((q) => (
                <li key={q.id}>{q.question.join(" ")}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* SQL Examples */}
      {(parsed.instructions?.example_question_sqls?.length ?? 0) > 0 && (
        <AccordionItem value="sql">
          <AccordionTrigger className="text-xs font-medium">
            SQL Examples ({parsed.instructions?.example_question_sqls?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="max-h-64 space-y-3 overflow-auto">
              {(parsed.instructions?.example_question_sqls ?? []).map((ex) => (
                <div key={ex.id}>
                  <p className="text-xs font-medium">{ex.question.join(" ")}</p>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[10px] font-mono leading-relaxed">
                    {ex.sql.join("\n")}
                  </pre>
                  {ex.usage_guidance && ex.usage_guidance.length > 0 && (
                    <p className="mt-1 text-[10px] italic text-muted-foreground">
                      {ex.usage_guidance.join("; ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Measures */}
      {(parsed.instructions?.sql_snippets?.measures?.length ?? 0) > 0 && (
        <AccordionItem value="measures">
          <AccordionTrigger className="text-xs font-medium">
            Measures ({parsed.instructions?.sql_snippets?.measures?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 text-xs">
              {(parsed.instructions?.sql_snippets?.measures ?? []).map((m) => (
                <div key={m.id} className="flex items-baseline gap-2 py-0.5">
                  <code className="rounded bg-muted px-1 font-mono text-[10px]">{m.alias}</code>
                  <span className="text-muted-foreground">{m.sql.join(" ")}</span>
                  {m.synonyms && m.synonyms.length > 0 && (
                    <span className="flex gap-0.5">
                      {m.synonyms.map((s, si) => (
                        <Badge key={si} variant="outline" className="text-[9px]">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Filters */}
      {(parsed.instructions?.sql_snippets?.filters?.length ?? 0) > 0 && (
        <AccordionItem value="filters">
          <AccordionTrigger className="text-xs font-medium">
            Filters ({parsed.instructions?.sql_snippets?.filters?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 text-xs">
              {(parsed.instructions?.sql_snippets?.filters ?? []).map((f) => (
                <div key={f.id} className="flex items-baseline gap-2 py-0.5">
                  <code className="rounded bg-muted px-1 font-mono text-[10px]">
                    {f.display_name}
                  </code>
                  <span className="text-muted-foreground">{f.sql.join(" ")}</span>
                  {f.synonyms && f.synonyms.length > 0 && (
                    <span className="flex gap-0.5">
                      {f.synonyms.map((s, si) => (
                        <Badge key={si} variant="outline" className="text-[9px]">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Dimensions */}
      {(parsed.instructions?.sql_snippets?.expressions?.length ?? 0) > 0 && (
        <AccordionItem value="dimensions">
          <AccordionTrigger className="text-xs font-medium">
            Dimensions ({parsed.instructions?.sql_snippets?.expressions?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 text-xs">
              {(parsed.instructions?.sql_snippets?.expressions ?? []).map((e) => (
                <div key={e.id} className="flex items-baseline gap-2 py-0.5">
                  <code className="rounded bg-muted px-1 font-mono text-[10px]">{e.alias}</code>
                  <span className="text-muted-foreground">{e.sql.join(" ")}</span>
                  {e.synonyms && e.synonyms.length > 0 && (
                    <span className="flex gap-0.5">
                      {e.synonyms.map((s, si) => (
                        <Badge key={si} variant="outline" className="text-[9px]">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Join Relationships */}
      {(parsed.instructions?.join_specs?.length ?? 0) > 0 && (
        <AccordionItem value="joins">
          <AccordionTrigger className="text-xs font-medium">
            Join Relationships ({parsed.instructions?.join_specs?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1 text-xs">
              {(parsed.instructions?.join_specs ?? []).map((j) => {
                const rtMatch = j.sql
                  .find((s) => s.startsWith("--rt="))
                  ?.match(/--rt=FROM_RELATIONSHIP_TYPE_(\w+)--/);
                const rt = rtMatch ? rtMatch[1].toLowerCase().replace(/_/g, " ") : null;
                const sqlDisplay = j.sql.filter((s) => !s.startsWith("--rt=")).join(" ");
                return (
                  <div key={j.id} className="flex items-baseline gap-2 py-0.5">
                    <span className="truncate font-mono text-muted-foreground">{sqlDisplay}</span>
                    {rt && (
                      <Badge variant="outline" className="shrink-0 text-[9px]">
                        {rt}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Text Instructions */}
      {(parsed.instructions?.text_instructions?.length ?? 0) > 0 && (
        <AccordionItem value="instructions">
          <AccordionTrigger className="text-xs font-medium">
            Text Instructions ({parsed.instructions?.text_instructions?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 text-xs text-muted-foreground">
              {(parsed.instructions?.text_instructions ?? []).map((ti) => (
                <p key={ti.id} className="whitespace-pre-line">
                  {ti.content.join("\n")}
                </p>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Benchmarks */}
      {(parsed.benchmarks?.questions?.length ?? 0) > 0 && (
        <AccordionItem value="benchmarks">
          <AccordionTrigger className="text-xs font-medium">
            Benchmarks ({parsed.benchmarks?.questions?.length ?? 0})
          </AccordionTrigger>
          <AccordionContent>
            <div className="max-h-64 space-y-2 overflow-auto">
              {(parsed.benchmarks?.questions ?? []).map((b) => (
                <div key={b.id} className="rounded border p-2">
                  <p className="text-xs font-medium">{b.question.join(" ")}</p>
                  {b.answer && b.answer.length > 0 && (
                    <pre className="mt-1 rounded bg-muted/50 p-1 text-[10px] font-mono">
                      {b.answer[0].content.join("\n")}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}
