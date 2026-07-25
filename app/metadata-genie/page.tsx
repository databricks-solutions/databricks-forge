"use client";

/**
 * Meta Data Genie page.
 *
 * Three states:
 * 1. List / Empty -- shows deployed spaces or an empty state with Generate button
 * 2. Generating -- spinner while probe + LLM detection runs
 * 3. Summary -- rich preview of what was detected, with Deploy button
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Database,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Rocket,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { MetadataGenieDeployModal } from "@/components/metadata-genie/deploy-modal";
import type { MetadataGenieSpace } from "@/lib/metadata-genie/types";
import type { SerializedSpace } from "@/lib/genie/types";
import { loadSettings } from "@/lib/settings";

type PageState = "list" | "generating" | "summary";

export default function MetadataGeniePage() {
  const [state, setState] = useState<PageState>("list");
  const [spaces, setSpaces] = useState<MetadataGenieSpace[]>([]);
  const [draft, setDraft] = useState<MetadataGenieSpace | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trashTargetId, setTrashTargetId] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [availableCatalogs, setAvailableCatalogs] = useState<string[]>([]);
  const [selectedCatalogs, setSelectedCatalogs] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const fetchSpaces = useCallback(async () => {
    try {
      const res = await fetch("/api/metadata-genie");
      if (res.ok) {
        const data = await res.json();
        const all: MetadataGenieSpace[] = data.spaces ?? [];
        setSpaces(all.filter((s) => s.status !== "trashed"));
        const existingDraft = all.find((s) => s.status === "draft");
        if (existingDraft) {
          setDraft(existingDraft);
          setState("summary");
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
    // Fetch available catalogs for scope selection
    fetch("/api/metadata-genie/probe")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.catalogs) setAvailableCatalogs(data.catalogs);
      })
      .catch(() => {});
  }, [fetchSpaces]);

  // -------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    setState("generating");
    setPermissionError(null);
    try {
      const res = await fetch("/api/metadata-genie/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogScope: selectedCatalogs.length > 0 ? selectedCatalogs : undefined,
          questionComplexity: loadSettings().questionComplexity.metadataGenie,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403) {
          setState("list");
          setPermissionError(
            err.error ??
              "Insufficient permissions to access system.information_schema. " +
                "Ensure the service principal or user running this app has been granted " +
                "SELECT on system.information_schema tables.",
          );
          return;
        }
        throw new Error(err.error ?? "Generation failed");
      }

      const data: MetadataGenieSpace = await res.json();
      setDraft(data);
      setState("summary");
      toast.success("Analysis complete", {
        description: data.industryName ? `Detected: ${data.industryName}` : "Ready for deployment",
      });
    } catch (err) {
      setState("list");
      toast.error(err instanceof Error ? err.message : "Generation failed");
    }
  }, [selectedCatalogs]);

  // -------------------------------------------------------------------
  // Deploy complete callback
  // -------------------------------------------------------------------

  const handleDeployComplete = useCallback(() => {
    setDraft(null);
    setState("list");
    fetchSpaces();
    toast.success("Meta Data Genie deployed!");
  }, [fetchSpaces]);

  // -------------------------------------------------------------------
  // Trash
  // -------------------------------------------------------------------

  const confirmTrash = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/metadata-genie", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, dropViews: true }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Trash failed");
        }

        setSpaces((prev) => prev.filter((s) => s.id !== id));
        if (draft?.id === id) {
          setDraft(null);
          setState("list");
        }
        toast.success("Space trashed");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Trash failed");
      } finally {
        setTrashTargetId(null);
      }
    },
    [draft],
  );

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  const deployedSpaces = spaces.filter((s) => s.status === "deployed");

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meta Data Genie</h1>
          <p className="mt-1 text-muted-foreground">
            Ask natural language questions about your data estate using a Databricks Genie Space
            backed by curated metadata views.
          </p>
        </div>
        {state === "list" && !draft && deployedSpaces.length === 0 && (
          <Button onClick={handleGenerate}>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Metadata Genie
          </Button>
        )}
      </div>

      {/* Permission error card */}
      {permissionError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Permission Denied</p>
              <p className="mt-1 text-sm text-muted-foreground">{permissionError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setPermissionError(null)}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Catalog scope selection (shown when empty state) */}
      {state === "list" &&
        !draft &&
        deployedSpaces.length === 0 &&
        availableCatalogs.length > 1 && (
          <Collapsible open={optionsOpen} onOpenChange={setOptionsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {optionsOpen ? "Hide options" : "Scope to specific catalogs"}
                {selectedCatalogs.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    {selectedCatalogs.length} selected
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Restrict the Metadata Genie to specific catalogs. Leave empty to include all
                    catalogs.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableCatalogs.map((cat) => {
                      const selected = selectedCatalogs.includes(cat);
                      return (
                        <Badge
                          key={cat}
                          variant={selected ? "default" : "outline"}
                          className="cursor-pointer select-none text-xs"
                          onClick={() =>
                            setSelectedCatalogs((prev) =>
                              selected ? prev.filter((c) => c !== cat) : [...prev, cat],
                            )
                          }
                        >
                          {cat}
                          {selected && <X className="ml-1 h-3 w-3" />}
                        </Badge>
                      );
                    })}
                  </div>
                  {selectedCatalogs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-xs"
                      onClick={() => setSelectedCatalogs([])}
                    >
                      Clear selection
                    </Button>
                  )}
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}

      {/* -------------------------------------------------------------- */}
      {/* State: Generating                                               */}
      {/* -------------------------------------------------------------- */}
      {state === "generating" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 font-medium">Analyzing your data estate...</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Scanning system.information_schema, detecting industry context, and generating
              tailored questions.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">This typically takes 5-10 seconds</p>
          </CardContent>
        </Card>
      )}

      {/* -------------------------------------------------------------- */}
      {/* State: Summary (draft ready for deploy)                         */}
      {/* -------------------------------------------------------------- */}
      {state === "summary" && draft && (
        <div className="space-y-4">
          {/* Industry + domain header */}
          <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold">{draft.title}</h2>
                </div>
                <Badge variant="outline" className="shrink-0">
                  Draft
                </Badge>
              </div>

              <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Industry
                  </p>
                  <p className="mt-0.5 text-sm font-medium">
                    {draft.industryName ?? "Not detected"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Tables Scanned
                  </p>
                  <p className="mt-0.5 text-sm font-medium">{draft.tableCount.toLocaleString()}</p>
                </div>
              </div>

              {draft.domains && draft.domains.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Domains
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {draft.domains.map((d) => (
                      <Badge key={d} variant="secondary" className="text-[10px] font-normal">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {draft.catalogScope && draft.catalogScope.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    Scoped to {draft.catalogScope.length} catalog
                    {draft.catalogScope.length !== 1 && "s"}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] ${draft.lineageAccessible ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400" : "border-muted text-muted-foreground"}`}
                >
                  Lineage: {draft.lineageAccessible ? "Available" : "Not available"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Space content preview */}
          {draft.serializedSpace && <SpaceContentPreview serializedSpace={draft.serializedSpace} />}

          {/* Deploy button */}
          <div className="flex items-center gap-3">
            <Button onClick={() => setDeployModalOpen(true)}>
              <Rocket className="mr-2 h-4 w-4" />
              Deploy
            </Button>
            <Button variant="ghost" onClick={() => setTrashTargetId(draft.id)}>
              Discard
            </Button>
          </div>

          {/* Deploy modal */}
          <MetadataGenieDeployModal
            open={deployModalOpen}
            onOpenChange={setDeployModalOpen}
            spaceId={draft.id}
            spaceTitle={draft.title}
            onComplete={handleDeployComplete}
          />
        </div>
      )}

      {/* -------------------------------------------------------------- */}
      {/* State: List (deployed spaces)                                   */}
      {/* -------------------------------------------------------------- */}
      {state === "list" && !loading && (
        <>
          {deployedSpaces.length === 0 && !draft && (
            <Card>
              <CardContent className="py-12 text-center">
                <Database className="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p className="mt-4 font-medium">No Metadata Genie spaces yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Generate a Meta Data Genie to create a Genie Space backed by curated views over{" "}
                  <code className="text-xs">system.information_schema</code>. Your team can then ask
                  natural language questions about what data exists in your environment.
                </p>
                <Button className="mt-6" onClick={handleGenerate}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Metadata Genie
                </Button>
              </CardContent>
            </Card>
          )}

          {deployedSpaces.length > 0 && (
            <div className="space-y-2">
              {deployedSpaces.map((space) => (
                <Collapsible
                  key={space.id}
                  open={expandedId === space.id}
                  onOpenChange={(open) => setExpandedId(open ? space.id : null)}
                >
                  {/* Row */}
                  <div className="flex items-center gap-3 rounded-md border px-4 py-3">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        {expandedId === space.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{space.title}</span>
                    {space.industryName && <Badge variant="secondary">{space.industryName}</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {space.tableCount.toLocaleString()} tables
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {space.spaceUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={space.spaceUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            Open
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrashTargetId(space.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  <CollapsibleContent>
                    <div className="rounded-b-md border border-t-0 bg-muted/30 px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <DetailItem label="Industry" value={space.industryName ?? "Not detected"} />
                        <DetailItem
                          label="Tables Scanned"
                          value={space.tableCount.toLocaleString()}
                        />
                        <DetailItem label="Domains" value={space.domains?.join(", ") ?? "N/A"} />
                        <DetailItem
                          label="View Schema"
                          value={
                            space.viewCatalog && space.viewSchema
                              ? `${space.viewCatalog}.${space.viewSchema}`
                              : "N/A"
                          }
                        />
                      </div>

                      <div className="mt-4">
                        <SpaceContentPreview serializedSpace={space.serializedSpace} />
                      </div>

                      <p className="mt-4 text-xs text-muted-foreground">
                        Created {new Date(space.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </>
      )}

      {/* Loading skeleton */}
      {loading && state === "list" && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Trash confirmation dialog */}
      <AlertDialog
        open={trashTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setTrashTargetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Metadata Genie Space?</AlertDialogTitle>
            <AlertDialogDescription>
              This will trash the Genie Space and drop all curated metadata views from the target
              schema. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (trashTargetId) confirmTrash(trashTargetId);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function SpaceContentPreview({ serializedSpace }: { serializedSpace: string }) {
  const sp: SerializedSpace | null = useMemo(() => {
    if (!serializedSpace) return null;
    try {
      return JSON.parse(serializedSpace) as SerializedSpace;
    } catch {
      return null;
    }
  }, [serializedSpace]);

  if (!sp) return null;

  const tables = sp.data_sources?.tables ?? [];
  const questions = sp.config?.sample_questions ?? [];
  const sqls = sp.instructions?.example_question_sqls ?? [];
  const measures = sp.instructions?.sql_snippets?.measures ?? [];
  const filters = sp.instructions?.sql_snippets?.filters ?? [];
  const expressions = sp.instructions?.sql_snippets?.expressions ?? [];
  const joins = sp.instructions?.join_specs ?? [];
  const instructions = sp.instructions?.text_instructions ?? [];
  const benchmarkQs = sp.benchmarks?.questions ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Tables" value={tables.length} />
        <StatCard label="SQL Examples" value={sqls.length} />
        <StatCard label="Joins" value={joins.length} />
        <StatCard label="Questions" value={questions.length} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Measures" value={measures.length} />
        <StatCard label="Filters" value={filters.length} />
        <StatCard label="Dimensions" value={expressions.length} />
        <StatCard label="Benchmarks" value={benchmarkQs.length} />
      </div>

      <Accordion type="multiple" className="w-full">
        {tables.length > 0 && (
          <AccordionItem value="tables">
            <AccordionTrigger className="text-xs font-medium">
              Tables &amp; Views ({tables.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="max-h-48 space-y-1 overflow-auto">
                {tables.map((t) => (
                  <div key={t.identifier} className="flex items-baseline gap-2 text-xs">
                    <span className="truncate font-mono text-muted-foreground">{t.identifier}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {questions.length > 0 && (
          <AccordionItem value="questions">
            <AccordionTrigger className="text-xs font-medium">
              Sample Questions ({questions.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {questions.map((q) => (
                  <div key={q.id} className="py-0.5 text-xs text-muted-foreground">
                    {q.question.join(" ")}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {sqls.length > 0 && (
          <AccordionItem value="sql">
            <AccordionTrigger className="text-xs font-medium">
              SQL Examples ({sqls.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="max-h-64 space-y-3 overflow-auto">
                {sqls.map((ex) => (
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

        {measures.length > 0 && (
          <AccordionItem value="measures">
            <AccordionTrigger className="text-xs font-medium">
              Measures ({measures.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {measures.map((m) => (
                  <div key={m.id} className="flex items-baseline gap-2 py-0.5 text-xs">
                    <code className="rounded bg-muted px-1 font-mono text-[10px]">{m.alias}</code>
                    <span className="text-muted-foreground">{m.sql.join(" ")}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {filters.length > 0 && (
          <AccordionItem value="filters">
            <AccordionTrigger className="text-xs font-medium">
              Filters ({filters.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {filters.map((f) => (
                  <div key={f.id} className="flex items-baseline gap-2 py-0.5 text-xs">
                    <code className="rounded bg-muted px-1 font-mono text-[10px]">
                      {f.display_name}
                    </code>
                    <span className="text-muted-foreground">{f.sql.join(" ")}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {expressions.length > 0 && (
          <AccordionItem value="dimensions">
            <AccordionTrigger className="text-xs font-medium">
              Dimensions ({expressions.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {expressions.map((e) => (
                  <div key={e.id} className="flex items-baseline gap-2 py-0.5 text-xs">
                    <code className="rounded bg-muted px-1 font-mono text-[10px]">{e.alias}</code>
                    <span className="text-muted-foreground">{e.sql.join(" ")}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {joins.length > 0 && (
          <AccordionItem value="joins">
            <AccordionTrigger className="text-xs font-medium">
              Join Relationships ({joins.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 text-xs">
                {joins.map((j) => (
                  <div key={j.id} className="flex items-baseline gap-2 py-0.5">
                    <span className="truncate font-mono text-muted-foreground">
                      {j.sql.filter((s: string) => !s.startsWith("--rt=")).join(" ")}
                    </span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {instructions.length > 0 && (
          <AccordionItem value="instructions">
            <AccordionTrigger className="text-xs font-medium">
              Text Instructions ({instructions.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {instructions.map((ti) => (
                  <div key={ti.id} className="whitespace-pre-line text-xs text-muted-foreground">
                    {ti.content.join("\n")}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
