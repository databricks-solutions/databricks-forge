"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  Presentation,
  FileText,
  FileCode,
  Braces,
  Briefcase,
  Loader2,
  ExternalLink,
  RotateCcw,
  Rocket,
} from "lucide-react";
import { EXPORT } from "@/lib/help-text";

interface ExportToolbarProps {
  runId: string;
  businessName: string;
  scanId?: string | null;
}

const EXPORT_FORMATS = [
  { key: "excel", label: "Excel (.xlsx)", icon: FileSpreadsheet, description: EXPORT.excel },
  { key: "pptx", label: "PowerPoint (.pptx)", icon: Presentation, description: EXPORT.pptx },
  { key: "pdf", label: "PDF", icon: FileText, description: EXPORT.pdf },
  { key: "csv", label: "CSV", icon: FileCode, description: EXPORT.csv },
  { key: "json", label: "JSON", icon: Braces, description: EXPORT.json },
] as const;

export function ExportToolbar({ runId, businessName, scanId }: ExportToolbarProps) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [notebookUrl, setNotebookUrl] = useState<string | null>(null);
  const [hasDeployed, setHasDeployed] = useState(false);
  const [sqlProgress, setSqlProgress] = useState<{
    generating: boolean;
    generated: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}/exports`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.exports) return;
        const nb = data.exports.find(
          (e: { format: string; filePath?: string | null }) =>
            e.format === "notebooks" && e.filePath,
        );
        if (nb?.filePath) {
          setNotebookUrl(nb.filePath);
          setHasDeployed(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Poll the SQL engine status so the toolbar can warn the user that
  // notebook / Excel exports will contain partial SQL while the background
  // job is still in flight. Self-stops once the job leaves `generating`.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/sql-engine/generate/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const generating = data?.status === "generating";
        setSqlProgress({
          generating,
          generated: data?.counts?.generated ?? 0,
          total: data?.counts?.total ?? data?.total ?? 0,
        });
        if (generating) {
          timer = setTimeout(tick, 5000);
        }
      } catch {
        /* ignore */
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const handleExport = async (format: string) => {
    setExporting(format);
    try {
      if (format === "notebooks") {
        const res = await fetch(`/api/export/${runId}?format=notebooks`);
        if (!res.ok) throw new Error("Export failed");
        const data = await res.json();
        if (data.url) {
          setNotebookUrl(data.url);
          setHasDeployed(true);
        }
        toast.success(`Deployed ${data.count ?? 0} notebooks to workspace`);
        return;
      }

      const res = await fetch(`/api/export/${runId}?format=${format}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const extMap: Record<string, string> = {
        excel: "xlsx",
        pptx: "pptx",
        pdf: "pdf",
        csv: "csv",
        json: "json",
      };
      const ext = extMap[format] ?? format;
      a.download = `forge_${businessName.replace(/\s+/g, "_")}_${runId.substring(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${format.toUpperCase()} exported successfully`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${format} export failed`);
    } finally {
      setExporting(null);
    }
  };

  const handleBriefingExport = async () => {
    if (!scanId) return;
    setExporting("briefing");
    try {
      const url = `/api/export/executive-briefing?scanId=${scanId}&runId=${runId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `forge_executive_briefing_${businessName.replace(/\s+/g, "_")}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success("Executive Briefing exported successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Executive Briefing export failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {sqlProgress?.generating && (
        <span
          className="hidden gap-1 rounded-md border border-blue-500/30 bg-blue-500/5 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300 sm:inline-flex"
          title="SQL generation is still running. Exports will include partial SQL until the background job finishes."
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          SQL in progress — {sqlProgress.generated}/{sqlProgress.total} ready; exports use partial
          SQL
        </span>
      )}
      {/* Export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!exporting}>
            {exporting && exporting !== "notebooks" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {EXPORT_FORMATS.map(({ key, label, icon: Icon, description }) => (
            <DropdownMenuItem key={key} disabled={!!exporting} onClick={() => handleExport(key)}>
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div>{exporting === key ? "Exporting..." : label}</div>
                  <div className="text-[10px] text-muted-foreground font-normal">{description}</div>
                </div>
              </div>
            </DropdownMenuItem>
          ))}
          {scanId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!exporting} onClick={handleBriefingExport}>
                <Briefcase className="mr-2 h-4 w-4" />
                {exporting === "briefing" ? "Exporting..." : "Executive Briefing"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Deploy actions */}
      {hasDeployed ? (
        <>
          <Button size="sm" onClick={() => window.open(notebookUrl!, "_blank")}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open Notebooks
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!!exporting}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {exporting === "notebooks" ? "Deploying..." : "Redeploy"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Redeploy notebooks?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will overwrite all previously deployed notebooks in the workspace. Any manual
                  edits made to those notebooks will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleExport("notebooks")}>
                  Redeploy
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <Button size="sm" disabled={!!exporting} onClick={() => handleExport("notebooks")}>
          <Rocket className="mr-1.5 h-3.5 w-3.5" />
          {exporting === "notebooks" ? "Deploying..." : "Deploy Notebooks"}
        </Button>
      )}
    </div>
  );
}
