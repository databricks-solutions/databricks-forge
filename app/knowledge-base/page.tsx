"use client";

/**
 * Knowledge Base page — document management for RAG.
 *
 * Upload strategy packs, data dictionaries, governance policies, and other
 * documents. Documents are chunked, embedded via databricks-qwen3-embedding-0-6b,
 * and stored in pgvector for semantic search and RAG retrieval.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { loadSettings } from "@/lib/settings";
import { FileText, Upload, Trash2, CheckCircle2, Clock, AlertCircle, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  category: string;
  chunkCount: number;
  sizeBytes: number;
  status: string;
  uploadedBy: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { value: "strategy", label: "Strategy Pack" },
  { value: "data_dictionary", label: "Data Dictionary" },
  { value: "governance_policy", label: "Governance Policy" },
  { value: "architecture", label: "Architecture Docs" },
  { value: "other", label: "Other" },
];

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  processing: {
    icon: <Clock className="size-3.5" />,
    label: "Processing",
    color: "text-amber-600",
  },
  ready: { icon: <CheckCircle2 className="size-3.5" />, label: "Ready", color: "text-green-600" },
  failed: { icon: <AlertCircle className="size-3.5" />, label: "Failed", color: "text-red-600" },
  empty: { icon: <AlertCircle className="size-3.5" />, label: "Empty", color: "text-gray-500" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  const searchParams = useSearchParams();
  const highlightDocId = searchParams?.get("doc") ?? "";
  const [documents, setDocuments] = React.useState<DocumentRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [category, setCategory] = React.useState("other");
  const [dragActive, setDragActive] = React.useState(false);
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [disabledReason, setDisabledReason] = React.useState<"infra" | "setting" | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (highlightDocId) {
      const el = document.getElementById(`doc-${highlightDocId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightDocId, documents]);

  const fetchDocuments = React.useCallback(async () => {
    try {
      const settings = loadSettings();
      if (!settings.semanticSearchEnabled) {
        setEnabled(false);
        setDisabledReason("setting");
        setLoading(false);
        return;
      }
      const resp = await fetch("/api/knowledge-base");
      if (resp.ok) {
        const data = await resp.json();
        const isEnabled = data.enabled ?? true;
        setEnabled(isEnabled);
        if (!isEnabled) setDisabledReason("infra");
        setDocuments(data.documents ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  if (!loading && enabled === false) {
    return (
      <div className="container mx-auto max-w-4xl py-12">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-lg">Knowledge Base Unavailable</CardTitle>
            <CardDescription>
              {disabledReason === "setting" ? (
                "Semantic search and knowledge base have been disabled in Settings. Re-enable the toggle to use this feature."
              ) : (
                <>
                  The embedding endpoint (<code>serving-endpoint-embedding</code>) is not
                  configured. Deploy with the embedding resource binding to enable document uploads
                  and semantic search.
                </>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", category);

        const resp = await fetch("/api/knowledge-base/upload", {
          method: "POST",
          body: formData,
        });

        if (resp.ok) {
          toast.success(`Uploaded ${file.name}`);
        } else {
          const err = await resp.json();
          toast.error(`Failed to upload ${file.name}: ${err.error}`);
        }
      }
      await fetchDocuments();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    try {
      const resp = await fetch(`/api/knowledge-base?id=${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success(`Deleted ${filename}`);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      } else {
        toast.error("Failed to delete document");
      }
    } catch {
      toast.error("Failed to delete document");
    }
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Knowledge Base"
        subtitle="Upload strategy documents, data dictionaries, and governance policies to enhance AI analysis."
      />

      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload Documents</CardTitle>
          <CardDescription>
            Supported formats: PDF, Markdown (.md), plain text (.txt). Max 20 MB per file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 mb-4">
            <div className="w-48">
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="mr-2 size-4" />
              {uploading ? "Uploading…" : "Choose Files"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf"
              onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
            />
          </div>

          {/* Drop zone */}
          <div
            onDragEnter={onDrag}
            onDragLeave={onDrag}
            onDragOver={onDrag}
            onDrop={onDrop}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20 hover:border-muted-foreground/40"
            }`}
          >
            <FileUp className="mx-auto mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Drag and drop files here, or click &ldquo;Choose Files&rdquo; above
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Document list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Documents
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {documents.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="mb-3 size-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload strategy packs, data dictionaries, or governance policies to enhance AI
                analysis
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => {
                const statusCfg = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.processing;
                return (
                  <div
                    key={doc.id}
                    id={`doc-${doc.id}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors ${highlightDocId === doc.id ? "ring-2 ring-primary" : ""}`}
                  >
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatSize(doc.sizeBytes)}
                        </span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {CATEGORIES.find((c) => c.value === doc.category)?.label || doc.category}
                        </Badge>
                        {doc.chunkCount > 0 && (
                          <>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">
                              {doc.chunkCount} chunks
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${statusCfg.color}`}>
                      {statusCfg.icon}
                      {statusCfg.label}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      className="size-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
