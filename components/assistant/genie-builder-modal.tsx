"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, AlertTriangle } from "lucide-react";
import { loadSettings } from "@/lib/settings";
import { BuildModeSelector, type BuildMode } from "@/components/genie/build-mode-selector";
import { useGenieBuild } from "@/components/providers/genie-build-provider";
import { showBuildToast } from "./genie-build-toast";
import type { TableEnrichmentData } from "./ask-forge-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenieBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: string[];
  domain?: string;
  conversationSummary?: string;
  tableEnrichments?: TableEnrichmentData[];
  sqlBlocks?: string[];
  onBuildStarted?: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Inner content -- remounts each time the dialog opens, resetting state
// ---------------------------------------------------------------------------

function GenieBuilderContent({
  onOpenChange,
  tables,
  domain,
  conversationSummary,
  onBuildStarted,
}: Omit<GenieBuilderModalProps, "open" | "tableEnrichments" | "sqlBlocks">) {
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { startBuild } = useGenieBuild();

  const buildConfig = useCallback(
    (mode: "fast" | "full") => {
      const settings = loadSettings();
      const g = settings.genieEngineDefaults;
      return {
        title: undefined as string | undefined,
        description: undefined as string | undefined,
        domain: domain || undefined,
        llmRefinement: g.llmRefinement,
        autoTimePeriods: g.autoTimePeriods,
        generateTrustedAssets: g.generateTrustedAssets,
        generateBenchmarks: g.generateBenchmarks,
        generateMetricViews: g.generateMetricViews,
        globalInstructions: undefined as string | undefined,
        conversationSummary: conversationSummary || undefined,
        questionComplexity: settings.questionComplexity.adhocGenie,
        qualityPreset: g.qualityPreset,
        mode,
      };
    },
    [domain, conversationSummary],
  );

  const handleModeSelect = useCallback(
    async (mode: BuildMode) => {
      setStarting(true);
      setStartError(null);
      const engineMode = mode === "fast" ? "fast" : "full";
      const jobId = await startBuild(tables, buildConfig(engineMode), "ask-forge");
      if (!jobId) {
        setStarting(false);
        setStartError("Failed to start build. Please try again.");
        return;
      }
      onOpenChange(false);
      onBuildStarted?.(jobId);
      showBuildToast(jobId, () => {
        /* deploy handled via toast's built-in Studio button */
      });
    },
    [tables, buildConfig, startBuild, onOpenChange, onBuildStarted],
  );

  return (
    <DialogContent className="max-h-[85vh] max-w-2xl flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          Create Genie Space
        </DialogTitle>
        <DialogDescription>
          Choose a build mode to generate your Genie Space. Progress will appear in a toast so you
          can continue your conversation.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-4">
          <BuildModeSelector
            onSelect={handleModeSelect}
            tableCount={tables.length}
            disabled={starting}
          />
        </div>

        {startError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              {startError}
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper -- conditionally mounts content when open
// ---------------------------------------------------------------------------

export function GenieBuilderModal({
  open,
  onOpenChange,
  tables,
  domain,
  conversationSummary,
  onBuildStarted,
}: GenieBuilderModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <GenieBuilderContent
          onOpenChange={onOpenChange}
          tables={tables}
          domain={domain}
          conversationSummary={conversationSummary}
          onBuildStarted={onBuildStarted}
        />
      )}
    </Dialog>
  );
}
