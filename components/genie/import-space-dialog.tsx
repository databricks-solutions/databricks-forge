"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { SpaceHealthReport } from "@/lib/genie/health-checks/types";
import type { SpaceMetadata } from "@/lib/genie/space-metadata";

interface ImportResult {
  title: string;
  serializedSpace: string;
  metadata: SpaceMetadata | null;
  healthReport: SpaceHealthReport;
}

interface ImportSpaceDialogProps {
  onImported: (result: ImportResult) => void;
}

export function ImportSpaceDialog({ onImported }: ImportSpaceDialogProps) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!json.trim()) {
      toast.error("Please paste the Genie Space JSON");
      return;
    }

    setAnalyzing(true);
    try {
      const res = await fetch("/api/genie-spaces/analyze-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Analysis failed");
      }

      const result: ImportResult = await res.json();
      toast.success(`Analyzed: ${result.title} (Grade: ${result.healthReport.grade})`);
      onImported(result);
      setOpen(false);
      setJson("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to analyze JSON");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 size-4" />
          Import JSON
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Genie Space JSON</DialogTitle>
          <DialogDescription>
            Paste a Genie Space JSON configuration to analyze it without API access. Accepts either
            a raw <code>serialized_space</code> object or the full API response.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder='{"data_sources": {...}, "instructions": {...}, ...}'
          value={json}
          onChange={(e) => setJson(e.target.value)}
          className="min-h-[300px] font-mono text-xs"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAnalyze} disabled={analyzing || !json.trim()}>
            {analyzing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Analyze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
