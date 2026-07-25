"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  FileSpreadsheet,
  Presentation,
  FileText,
  Briefcase,
  Loader2,
  ChevronDown,
} from "lucide-react";

const FORMATS = [
  { key: "excel", label: "Portfolio Excel", icon: FileSpreadsheet, ext: "xlsx" },
  { key: "pptx", label: "Portfolio PPTX", icon: Presentation, ext: "pptx" },
  { key: "pdf", label: "Executive Brief (PDF)", icon: FileText, ext: "pdf" },
  { key: "workshop", label: "D4B Workshop Pack", icon: Briefcase, ext: "pptx" },
] as const;

export function PortfolioExportButton() {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleExport(format: string) {
    setDownloading(format);
    setOpen(false);
    try {
      const res = await fetch(`/api/export/portfolio?format=${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("Content-Disposition");
      const match = cd?.match(/filename="(.+)"/);
      a.download = match?.[1] ?? `forge_portfolio.${format === "workshop" ? "pptx" : format}`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Portfolio export failed:", err);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        disabled={downloading !== null}
        className="gap-2"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Export
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => handleExport(f.key)}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {f.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
