"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import type {
  StrategyDocument,
  StrategyInitiative,
  StrategyAlignmentEntry,
} from "@/lib/domain/types";

interface StrategyWithAlignments {
  doc: StrategyDocument;
  alignments: StrategyAlignmentEntry[];
}

function GapStatusBadge({
  gapType,
}: {
  gapType: "supported" | "partial" | "blocked" | "unmatched" | null;
}) {
  if (!gapType || gapType === "unmatched") {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        Not assessed
      </Badge>
    );
  }
  const config: Record<string, { label: string; className: string }> = {
    supported: {
      label: "Supported",
      className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
    },
    partial: {
      label: "Partial",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    },
    blocked: {
      label: "Blocked",
      className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    },
  };
  const c = config[gapType] ?? {
    label: "Not assessed",
    className: "bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={c.className}>
      {c.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: StrategyDocument["status"] }) {
  const variants: Record<string, "default" | "secondary" | "outline"> = {
    draft: "secondary",
    analyzed: "default",
    archived: "outline",
  };
  return <Badge variant={variants[status] ?? "secondary"}>{status}</Badge>;
}

export default function StrategyAlignmentPage() {
  const [docs, setDocs] = useState<StrategyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alignmentsByStrategy, setAlignmentsByStrategy] = useState<
    Record<string, StrategyAlignmentEntry[]>
  >({});
  const [deleteTarget, setDeleteTarget] = useState<StrategyDocument | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/business-value/strategy");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const fetchAlignments = useCallback(
    async (id: string) => {
      if (alignmentsByStrategy[id]) return;
      try {
        const res = await fetch(`/api/business-value/strategy/${id}`);
        if (!res.ok) return;
        const { alignments } = (await res.json()) as StrategyWithAlignments;
        setAlignmentsByStrategy((prev) => ({ ...prev, [id]: alignments ?? [] }));
      } catch {
        setAlignmentsByStrategy((prev) => ({ ...prev, [id]: [] }));
      }
    },
    [alignmentsByStrategy],
  );

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      fetchAlignments(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitLoading(true);
    try {
      const res = await fetch("/api/business-value/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create");
      }
      const created = await res.json();
      setDocs((prev) => [created, ...prev]);
      setTitle("");
      setContent("");
      toast.success("Strategy document created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create strategy document");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/business-value/strategy?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setExpandedId((prev) => (prev === deleteTarget.id ? null : prev));
      setAlignmentsByStrategy((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      toast.success("Strategy document deleted");
    } catch {
      toast.error("Failed to delete strategy document");
    } finally {
      setDeleteLoading(false);
    }
  };

  const getGapForInitiative = (
    initiativeIndex: number,
    alignments: StrategyAlignmentEntry[],
  ): "supported" | "partial" | "blocked" | "unmatched" | null => {
    const a = alignments.find((x) => x.initiativeIndex === initiativeIndex);
    return (a?.gapType as "supported" | "partial" | "blocked" | "unmatched") ?? null;
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Strategy Alignment"
        subtitle="Validate your data strategy against discovered opportunities"
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload Strategy Document</CardTitle>
          <CardDescription>
            Paste your data strategy text to parse initiatives and assess alignment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="strategy-title">Title</Label>
              <Input
                id="strategy-title"
                placeholder="e.g. Q1 Data Strategy"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-content">Content</Label>
              <Textarea
                id="strategy-content"
                placeholder="Paste your strategy document text here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="resize-none"
                disabled={submitLoading}
              />
            </div>
            <Button type="submit" disabled={submitLoading || !title.trim() || !content.trim()}>
              {submitLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Analyze Strategy"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-4 text-base font-semibold">Existing Strategies</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">
                Upload a data strategy document to begin alignment analysis
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <Card key={doc.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{doc.title}</CardTitle>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={doc.status} />
                        {doc.alignmentScore != null && (
                          <Badge variant="outline">
                            Alignment: {(doc.alignmentScore * 100).toFixed(0)}%
                          </Badge>
                        )}
                        <span className="text-muted-foreground text-sm">
                          {doc.parsedInitiatives?.length ?? 0} initiatives
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleExpand(doc.id)}
                        disabled={!doc.parsedInitiatives?.length}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${expandedId === doc.id ? "rotate-180" : ""}`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(doc)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {expandedId === doc.id && doc.parsedInitiatives?.length ? (
                  <CardContent className="pt-0">
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Expected Outcomes</TableHead>
                            <TableHead>Data Requirements</TableHead>
                            <TableHead className="w-32">Gap Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(doc.parsedInitiatives as StrategyInitiative[]).map((init) => (
                            <TableRow key={init.index}>
                              <TableCell>{init.index + 1}</TableCell>
                              <TableCell className="max-w-[200px] font-medium">
                                <span className="block truncate" title={init.name}>
                                  {init.name}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-xs truncate">
                                {init.description}
                              </TableCell>
                              <TableCell className="max-w-xs">
                                <span
                                  className="line-clamp-2 block"
                                  title={init.expectedOutcomes?.join(", ") || undefined}
                                >
                                  {init.expectedOutcomes?.join(", ") || "-"}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-xs">
                                <span
                                  className="line-clamp-2 block"
                                  title={init.dataRequirements?.join(", ") || undefined}
                                >
                                  {init.dataRequirements?.join(", ") || "-"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <GapStatusBadge
                                  gapType={getGapForInitiative(
                                    init.index,
                                    alignmentsByStrategy[doc.id] ?? [],
                                  )}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete strategy document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.title}&quot; and its alignment data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteLoading}
              onClick={() => void handleDelete()}
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
