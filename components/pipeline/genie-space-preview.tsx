"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type {
  GenieSpaceRecommendation,
  SerializedSpace,
  ColumnEnrichment,
  MetricViewProposal,
  BenchmarkInput,
} from "@/lib/genie/types";

interface GenieSpacePreviewProps {
  runId: string;
}

interface ExtendedRecommendation extends GenieSpaceRecommendation {
  benchmarks?: string | null;
  columnEnrichments?: string | null;
  metricViewProposals?: string | null;
}

export function GenieSpacePreview({ runId }: GenieSpacePreviewProps) {
  const [recommendations, setRecommendations] = useState<ExtendedRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/genie-recommendations`);
      const data = await res.json();
      if (res.ok) {
        setRecommendations(data.recommendations ?? []);
        if (data.recommendations?.length > 0 && !selectedDomain) {
          setSelectedDomain(data.recommendations[0].domain);
        }
      }
    } catch {
      // Handled by parent
    } finally {
      setLoading(false);
    }
  }, [runId, selectedDomain]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const applyEdit = useCallback(
    async (domain: string, editAction: Record<string, unknown>) => {
      try {
        const res = await fetch(
          `/api/runs/${runId}/genie-engine/${encodeURIComponent(domain)}/space`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editAction),
          },
        );
        if (res.ok) {
          toast.success("Edit saved");
          fetchData();
        } else {
          const data = await res.json();
          toast.error(data.error || "Edit failed");
        }
      } catch {
        toast.error("Edit failed");
      }
    },
    [runId, fetchData],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">
            No recommendations available. Run the engine to generate spaces.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rec = recommendations.find((r) => r.domain === selectedDomain);
  const parsed: SerializedSpace | null = rec
    ? (() => {
        try {
          return JSON.parse(rec.serializedSpace) as SerializedSpace;
        } catch {
          return null;
        }
      })()
    : null;

  const enrichments: ColumnEnrichment[] = rec?.columnEnrichments
    ? (() => {
        try {
          return JSON.parse(rec.columnEnrichments!) as ColumnEnrichment[];
        } catch {
          return [];
        }
      })()
    : [];

  const mvProposals: MetricViewProposal[] = rec?.metricViewProposals
    ? (() => {
        try {
          return JSON.parse(rec.metricViewProposals!) as MetricViewProposal[];
        } catch {
          return [];
        }
      })()
    : [];

  const benchmarks: BenchmarkInput[] = rec?.benchmarks
    ? (() => {
        try {
          return JSON.parse(rec.benchmarks!) as BenchmarkInput[];
        } catch {
          return [];
        }
      })()
    : [];

  return (
    <div className="space-y-4">
      {/* Domain selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Domain:</span>
        <Select value={selectedDomain ?? ""} onValueChange={setSelectedDomain}>
          <SelectTrigger className="h-8 w-64 text-sm">
            <SelectValue placeholder="Select domain" />
          </SelectTrigger>
          <SelectContent>
            {recommendations.map((r) => (
              <SelectItem key={r.domain} value={r.domain}>
                {r.domain} ({r.tableCount} tables, {r.useCaseCount} use cases)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rec && parsed && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Tables" value={rec.tableCount} />
            <StatCard label="Metric Views" value={rec.metricViewCount} />
            <StatCard label="Use Cases" value={rec.useCaseCount} />
            <StatCard label="SQL Examples" value={rec.sqlExampleCount} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Measures" value={rec.measureCount} />
            <StatCard label="Filters" value={rec.filterCount} />
            <StatCard label="Dimensions" value={rec.dimensionCount} />
            <StatCard label="Joins" value={rec.joinCount} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Benchmarks" value={benchmarks.length} />
            <StatCard label="Instructions" value={rec.instructionCount} />
            <StatCard label="Questions" value={rec.sampleQuestionCount} />
          </div>

          <Accordion type="multiple" defaultValue={["tables", "measures"]} className="w-full">
            {/* Tables & Views */}
            <AccordionItem value="tables">
              <AccordionTrigger className="text-xs font-medium">
                Tables &amp; Views ({rec.tableCount})
              </AccordionTrigger>
              <AccordionContent>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {rec.tables.map((t) => (
                    <div key={t} className="flex items-center gap-2 text-xs">
                      <span className="truncate font-mono text-muted-foreground">{t}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Metric Views */}
            {rec.metricViews.length > 0 && (
              <AccordionItem value="metric-views-data">
                <AccordionTrigger className="text-xs font-medium">
                  Metric Views ({rec.metricViewCount})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="max-h-48 space-y-1 overflow-auto">
                    {rec.metricViews.map((mv) => (
                      <div key={mv} className="flex items-center gap-2 text-xs">
                        <span className="truncate font-mono text-violet-500">{mv}</span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Column Enrichments */}
            {enrichments.length > 0 && (
              <AccordionItem value="columns">
                <AccordionTrigger className="text-xs font-medium">
                  Column Intelligence ({enrichments.length})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="max-h-64 space-y-1 overflow-auto">
                    {enrichments
                      .filter((e) => !e.hidden)
                      .slice(0, 50)
                      .map((e, i) => (
                        <div key={i} className="flex items-baseline gap-2 py-0.5 text-xs">
                          <code className="rounded bg-muted px-1 font-mono text-[10px]">
                            {e.columnName}
                          </code>
                          {e.description && (
                            <span className="text-muted-foreground">{e.description}</span>
                          )}
                          {e.synonyms.length > 0 && (
                            <span className="flex gap-1">
                              {e.synonyms.map((s, si) => (
                                <Badge key={si} variant="outline" className="text-[9px]">
                                  {s}
                                </Badge>
                              ))}
                            </span>
                          )}
                          {e.entityMatchingCandidate && (
                            <Badge className="bg-amber-500/10 text-amber-600 text-[9px]">
                              entity
                            </Badge>
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
                  <div className="space-y-1">
                    {(parsed.instructions?.sql_snippets?.measures ?? []).map((m) => (
                      <EditableSnippetRow
                        key={m.id}
                        id={m.id}
                        label={m.alias}
                        sql={m.sql.join(" ")}
                        onSave={(alias, sql) =>
                          applyEdit(rec.domain, {
                            type: "update_measure",
                            id: m.id,
                            alias,
                            sql: [sql],
                          })
                        }
                        onRemove={() => applyEdit(rec.domain, { type: "remove_measure", id: m.id })}
                      />
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
                  <div className="space-y-1">
                    {(parsed.instructions?.sql_snippets?.filters ?? []).map((f) => (
                      <EditableSnippetRow
                        key={f.id}
                        id={f.id}
                        label={f.display_name}
                        sql={f.sql.join(" ")}
                        onSave={(display_name, sql) =>
                          applyEdit(rec.domain, {
                            type: "update_filter",
                            id: f.id,
                            display_name,
                            sql: [sql],
                          })
                        }
                        onRemove={() => applyEdit(rec.domain, { type: "remove_filter", id: f.id })}
                      />
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
                  <div className="space-y-1">
                    {(parsed.instructions?.sql_snippets?.expressions ?? []).map((e) => (
                      <EditableSnippetRow
                        key={e.id}
                        id={e.id}
                        label={e.alias}
                        sql={e.sql.join(" ")}
                        onSave={(alias, sql) =>
                          applyEdit(rec.domain, {
                            type: "update_expression",
                            id: e.id,
                            alias,
                            sql: [sql],
                          })
                        }
                        onRemove={() =>
                          applyEdit(rec.domain, { type: "remove_expression", id: e.id })
                        }
                      />
                    ))}
                  </div>
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
                  <div className="space-y-1">
                    {(parsed.config?.sample_questions ?? []).map((q) => (
                      <EditableTextRow
                        key={q.id}
                        id={q.id}
                        text={q.question.join(" ")}
                        onSave={(text) =>
                          applyEdit(rec.domain, {
                            type: "update_question",
                            id: q.id,
                            question: [text],
                          })
                        }
                        onRemove={() =>
                          applyEdit(rec.domain, { type: "remove_question", id: q.id })
                        }
                      />
                    ))}
                  </div>
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
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Joins */}
            {(parsed.instructions?.join_specs?.length ?? 0) > 0 && (
              <AccordionItem value="joins">
                <AccordionTrigger className="text-xs font-medium">
                  Join Relationships ({parsed.instructions?.join_specs?.length ?? 0})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 text-xs">
                    {(parsed.instructions?.join_specs ?? []).map((j) => {
                      const rtMatch = j.sql
                        .find((s: string) => s.startsWith("--rt="))
                        ?.match(/--rt=FROM_RELATIONSHIP_TYPE_(\w+)--/);
                      const rt = rtMatch ? rtMatch[1].toLowerCase().replace(/_/g, " ") : null;
                      const sqlDisplay = j.sql
                        .filter((s: string) => !s.startsWith("--rt="))
                        .join(" ");
                      return (
                        <div key={j.id} className="flex items-baseline gap-2 py-0.5">
                          <span className="truncate font-mono text-muted-foreground">
                            {sqlDisplay}
                          </span>
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

            {/* Instructions */}
            {(parsed.instructions?.text_instructions?.length ?? 0) > 0 && (
              <AccordionItem value="instructions">
                <AccordionTrigger className="text-xs font-medium">
                  Text Instructions ({parsed.instructions?.text_instructions?.length ?? 0})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {(parsed.instructions?.text_instructions ?? []).map((ti) => (
                      <EditableTextRow
                        key={ti.id}
                        id={ti.id}
                        text={ti.content.join("\n")}
                        multiline
                        onSave={(text) =>
                          applyEdit(rec.domain, {
                            type: "update_instruction",
                            id: ti.id,
                            content: [text],
                          })
                        }
                        onRemove={() =>
                          applyEdit(rec.domain, { type: "remove_instruction", id: ti.id })
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Benchmarks */}
            {benchmarks.length > 0 && (
              <AccordionItem value="benchmarks">
                <AccordionTrigger className="text-xs font-medium">
                  Benchmark Questions ({benchmarks.length})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="max-h-64 space-y-3 overflow-auto">
                    {benchmarks.map((b, i) => (
                      <div key={i} className="rounded border p-2">
                        <p className="text-xs font-medium">{b.question}</p>
                        {b.alternatePhrasings.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {b.alternatePhrasings.map((ap, ai) => (
                              <Badge key={ai} variant="outline" className="text-[9px]">
                                {ap}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {b.expectedSql && (
                          <pre className="mt-1 rounded bg-muted/50 p-1 text-[10px] font-mono">
                            {b.expectedSql}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Metric View Proposals */}
            {mvProposals.length > 0 && (
              <AccordionItem value="metric-views">
                <AccordionTrigger className="text-xs font-medium">
                  Metric View Proposals ({mvProposals.length})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    {mvProposals.map((mv, i) => (
                      <MetricViewProposalCard
                        key={i}
                        proposal={mv}
                        runId={runId}
                        domain={rec.domain}
                        onDeployed={fetchData}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function EditableSnippetRow({
  label,
  sql,
  onSave,
  onRemove,
}: {
  id: string;
  label: string;
  sql: string;
  onSave: (label: string, sql: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(label);
  const [editSql, setEditSql] = useState(sql);

  const save = () => {
    onSave(editLabel, editSql);
    setEditing(false);
  };

  const cancel = () => {
    setEditLabel(label);
    setEditSql(sql);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1 rounded border border-violet-200 bg-violet-50/30 p-1.5">
        <Input
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          className="h-6 text-xs"
        />
        <Input
          value={editSql}
          onChange={(e) => setEditSql(e.target.value)}
          className="h-6 font-mono text-xs"
        />
        <div className="flex gap-1">
          <Button size="sm" variant="default" onClick={save} className="h-5 px-2 text-[10px]">
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} className="h-5 px-2 text-[10px]">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-baseline gap-2 py-0.5 text-xs">
      <code className="rounded bg-muted px-1 font-mono text-[10px]">{label}</code>
      <span className="text-muted-foreground">{sql}</span>
      <span className="ml-auto hidden gap-1 group-hover:flex">
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] text-violet-500 hover:text-violet-700"
        >
          edit
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] text-destructive hover:text-destructive/80"
        >
          remove
        </button>
      </span>
    </div>
  );
}

function EditableTextRow({
  text,
  multiline,
  onSave,
  onRemove,
}: {
  id: string;
  text: string;
  multiline?: boolean;
  onSave: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);

  const save = () => {
    onSave(editText);
    setEditing(false);
  };

  const cancel = () => {
    setEditText(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1 rounded border border-violet-200 bg-violet-50/30 p-1.5">
        {multiline ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full rounded border bg-background p-1 text-xs"
            rows={4}
          />
        ) : (
          <Input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="h-6 text-xs"
          />
        )}
        <div className="flex gap-1">
          <Button size="sm" variant="default" onClick={save} className="h-5 px-2 text-[10px]">
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} className="h-5 px-2 text-[10px]">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2 py-0.5 text-xs">
      <span className={`flex-1 ${multiline ? "whitespace-pre-line" : ""} text-muted-foreground`}>
        {text}
      </span>
      <span className="hidden shrink-0 gap-1 group-hover:flex">
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] text-violet-500 hover:text-violet-700"
        >
          edit
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] text-destructive hover:text-destructive/80"
        >
          remove
        </button>
      </span>
    </div>
  );
}

function MetricViewProposalCard({
  proposal,
  runId,
  domain,
  onDeployed,
}: {
  proposal: MetricViewProposal;
  runId: string;
  domain: string;
  onDeployed: () => void;
}) {
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const res = await fetch(
        `/api/runs/${runId}/genie-engine/${encodeURIComponent(domain)}/metric-views`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ddl: proposal.ddl,
            name: proposal.name,
            description: proposal.description,
          }),
        },
      );
      if (res.ok) {
        toast.success(`Metric view "${proposal.name}" created`);
        setDeployed(true);
        onDeployed();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create metric view");
      }
    } catch {
      toast.error("Failed to create metric view");
    } finally {
      setDeploying(false);
    }
  };

  const mv = {
    ...proposal,
    hasJoins: proposal.hasJoins ?? false,
    hasFilteredMeasures: proposal.hasFilteredMeasures ?? false,
    hasWindowMeasures: proposal.hasWindowMeasures ?? false,
    hasMaterialization: proposal.hasMaterialization ?? false,
    validationStatus: proposal.validationStatus ?? ("valid" as const),
    validationIssues: proposal.validationIssues ?? [],
  };
  const validationColor =
    mv.validationStatus === "valid"
      ? "bg-emerald-500/10 text-emerald-600"
      : mv.validationStatus === "warning"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-red-500/10 text-red-600";

  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{mv.name}</span>
        <div className="flex items-center gap-1">
          {mv.hasJoins && (
            <Badge variant="outline" className="text-[9px]">
              joins
            </Badge>
          )}
          {mv.hasFilteredMeasures && (
            <Badge variant="outline" className="text-[9px]">
              filtered
            </Badge>
          )}
          {mv.hasWindowMeasures && (
            <Badge variant="outline" className="text-[9px]">
              window
            </Badge>
          )}
          {mv.hasMaterialization && (
            <Badge variant="outline" className="text-[9px]">
              materialized
            </Badge>
          )}
          <Badge className={`text-[9px] ${validationColor}`}>{mv.validationStatus}</Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{mv.description}</p>
      {mv.validationIssues.length > 0 && (
        <div
          className={`mt-1.5 rounded p-1.5 ${mv.validationStatus === "error" ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}
        >
          <p
            className={`text-[10px] font-medium ${mv.validationStatus === "error" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}
          >
            {mv.validationStatus === "error"
              ? "Validation errors (deploy blocked):"
              : "Validation issues:"}
          </p>
          {mv.validationIssues.map((issue, idx) => (
            <p
              key={idx}
              className={`text-[10px] ${mv.validationStatus === "error" ? "text-red-600 dark:text-red-500" : "text-amber-600 dark:text-amber-500"}`}
            >
              - {issue}
            </p>
          ))}
        </div>
      )}
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[10px] font-mono leading-relaxed">
        {mv.ddl}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant={deployed ? "outline" : "default"}
          onClick={handleDeploy}
          disabled={deploying || deployed || mv.validationStatus === "error"}
          className="h-6 px-3 text-[10px]"
        >
          {deployed ? "Deployed" : deploying ? "Creating..." : "Deploy Metric View"}
        </Button>
        {mv.sourceTables.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Source: {mv.sourceTables.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
