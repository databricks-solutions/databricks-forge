"use client";

import { motion } from "motion/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fadeInUp } from "@/lib/motion";
import {
  BarChart3,
  Code,
  Database,
  FileText,
  FlaskConical,
  Link2,
  MessageSquare,
  Sparkles,
  Table2,
} from "lucide-react";
import type { SerializedSpace } from "@/lib/genie/types";

interface SpaceConfigViewerProps {
  space: SerializedSpace;
}

function SectionHeader({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {count > 0 ? (
        <Badge variant="secondary" className="h-5 min-w-[1.5rem] px-1.5 text-xs">
          {count}
        </Badge>
      ) : (
        <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
          not configured
        </Badge>
      )}
      <span>{label}</span>
    </div>
  );
}

function SqlBlock({ sql, label }: { sql: string[]; label?: string }) {
  return (
    <div className="overflow-hidden rounded border bg-muted/30">
      {label && (
        <div className="border-b bg-muted/50 px-3 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
      )}
      <pre className="max-h-40 overflow-auto p-3 text-xs">{sql.join("\n")}</pre>
    </div>
  );
}

function SummaryPill({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-xs">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="font-medium">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function SpaceConfigViewer({ space }: SpaceConfigViewerProps) {
  const tables = space.data_sources?.tables ?? [];
  const metricViews = space.data_sources?.metric_views ?? [];
  const textInstructions = space.instructions?.text_instructions ?? [];
  const exampleSqls = space.instructions?.example_question_sqls ?? [];
  const joinSpecs = space.instructions?.join_specs ?? [];
  const measures = space.instructions?.sql_snippets?.measures ?? [];
  const filters = space.instructions?.sql_snippets?.filters ?? [];
  const expressions = space.instructions?.sql_snippets?.expressions ?? [];
  const benchmarks = space.benchmarks?.questions ?? [];
  const sampleQuestions = space.config?.sample_questions ?? [];

  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        <SummaryPill icon={Table2} label="Tables" count={tables.length} />
        <SummaryPill icon={Sparkles} label="Joins" count={joinSpecs.length} />
        <SummaryPill icon={BarChart3} label="Measures" count={measures.length} />
        <SummaryPill icon={Link2} label="Filters" count={filters.length} />
        <SummaryPill icon={Code} label="Expressions" count={expressions.length} />
        <SummaryPill icon={FlaskConical} label="Benchmarks" count={benchmarks.length} />
        <SummaryPill icon={MessageSquare} label="Sample Q's" count={sampleQuestions.length} />
      </div>

      {/* Configuration accordion */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Space Configuration</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <Accordion type="multiple" className="w-full">
            {/* Data Sources -> Tables */}
            <AccordionItem value="tables">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Database}
                  label="Data Sources &rarr; Tables"
                  count={tables.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {tables.map((t, i) => (
                    <div key={i} className="rounded border px-3 py-2">
                      <code className="text-xs font-medium">{t.identifier}</code>
                      {t.description && t.description.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.description.join(" ")}
                        </p>
                      )}
                    </div>
                  ))}
                  {tables.length === 0 && (
                    <p className="text-xs text-muted-foreground">No tables configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Data Sources -> Metric Views */}
            <AccordionItem value="metric-views">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Database}
                  label="Data Sources &rarr; Metric Views"
                  count={metricViews.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {metricViews.map((m, i) => (
                    <div key={i} className="rounded border px-3 py-2">
                      <code className="text-xs font-medium">{m.identifier}</code>
                    </div>
                  ))}
                  {metricViews.length === 0 && (
                    <p className="text-xs text-muted-foreground">No metric views configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> Text Instructions */}
            <AccordionItem value="text-instructions">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={FileText}
                  label="Instructions &rarr; Text Instructions"
                  count={textInstructions.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {textInstructions.map((inst, i) => (
                    <div key={i} className="rounded border px-3 py-2">
                      <p className="whitespace-pre-wrap text-xs">{inst.content?.join("\n")}</p>
                    </div>
                  ))}
                  {textInstructions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No text instructions configured.
                    </p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> Example Question SQLs */}
            <AccordionItem value="example-sqls">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={FileText}
                  label="Instructions &rarr; Example Question SQLs"
                  count={exampleSqls.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {exampleSqls.map((ex, i) => (
                    <div key={i} className="space-y-1.5 rounded border px-3 py-2">
                      <p className="text-xs font-medium">{ex.question?.join(" ")}</p>
                      <SqlBlock sql={ex.sql} label="SQL" />
                    </div>
                  ))}
                  {exampleSqls.length === 0 && (
                    <p className="text-xs text-muted-foreground">No example SQLs configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> Join Specs */}
            <AccordionItem value="join-specs">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Sparkles}
                  label="Instructions &rarr; Join Specs"
                  count={joinSpecs.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {joinSpecs.map((j, i) => (
                    <div key={i} className="space-y-1.5 rounded border px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <code>{j.left?.alias ?? j.left?.identifier}</code>
                        <span className="text-muted-foreground">&harr;</span>
                        <code>{j.right?.alias ?? j.right?.identifier}</code>
                      </div>
                      <SqlBlock sql={j.sql} label="JOIN" />
                    </div>
                  ))}
                  {joinSpecs.length === 0 && (
                    <p className="text-xs text-muted-foreground">No join specs configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> SQL Snippets -> Measures */}
            <AccordionItem value="measures">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Code}
                  label="SQL Snippets &rarr; Measures"
                  count={measures.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {measures.map((m, i) => (
                    <div key={i} className="space-y-1.5 rounded border px-3 py-2">
                      <p className="text-xs font-medium">{m.alias}</p>
                      <SqlBlock sql={m.sql} label="Measure" />
                      {m.synonyms && m.synonyms.length > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          Synonyms: {m.synonyms.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                  {measures.length === 0 && (
                    <p className="text-xs text-muted-foreground">No measures configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> SQL Snippets -> Filters */}
            <AccordionItem value="filters">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Code}
                  label="SQL Snippets &rarr; Filters"
                  count={filters.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {filters.map((f, i) => (
                    <div key={i} className="space-y-1.5 rounded border px-3 py-2">
                      <p className="text-xs font-medium">{f.display_name}</p>
                      <SqlBlock sql={f.sql} label="Filter" />
                    </div>
                  ))}
                  {filters.length === 0 && (
                    <p className="text-xs text-muted-foreground">No filters configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Instructions -> SQL Snippets -> Expressions */}
            <AccordionItem value="expressions">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={Code}
                  label="SQL Snippets &rarr; Expressions"
                  count={expressions.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {expressions.map((e, i) => (
                    <div key={i} className="space-y-1.5 rounded border px-3 py-2">
                      <p className="text-xs font-medium">{e.alias}</p>
                      <SqlBlock sql={e.sql} label="Expression" />
                    </div>
                  ))}
                  {expressions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No expressions configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Benchmarks -> Questions */}
            <AccordionItem value="benchmarks">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={FlaskConical}
                  label="Benchmarks &rarr; Questions"
                  count={benchmarks.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {benchmarks.map((b, i) => (
                    <div key={i} className="rounded border px-3 py-2">
                      <p className="text-xs">{b.question?.join(" ")}</p>
                      {b.answer && b.answer.length > 0 && (
                        <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/50 p-2 text-[10px]">
                          {b.answer.map((a) => a.content?.join("\n")).join("\n")}
                        </pre>
                      )}
                    </div>
                  ))}
                  {benchmarks.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No benchmark questions configured.
                    </p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Config -> Sample Questions */}
            <AccordionItem value="sample-questions">
              <AccordionTrigger className="text-sm">
                <SectionHeader
                  icon={MessageSquare}
                  label="Config &rarr; Sample Questions"
                  count={sampleQuestions.length}
                />
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {sampleQuestions.map((q, i) => (
                    <div key={i} className="rounded border px-3 py-2">
                      <p className="text-xs">{q.question?.join(" ")}</p>
                    </div>
                  ))}
                  {sampleQuestions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No sample questions configured.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </motion.div>
  );
}
