"use client";

import { Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type BuildMode = "fast" | "full";

interface BuildModeSelectorProps {
  onSelect: (mode: BuildMode) => void;
  disabled?: boolean;
  tableCount?: number;
}

const modes: Array<{
  mode: BuildMode;
  icon: typeof Sparkles;
  title: string;
  recommended: boolean;
  description: string;
  detail: string;
}> = [
  {
    mode: "full",
    icon: Sparkles,
    title: "Full Engine",
    recommended: true,
    description:
      "7-pass AI engine with richer measures, filters, benchmarks, and higher quality scores.",
    detail: "Typically 1\u20133 minutes",
  },
  {
    mode: "fast",
    icon: Zap,
    title: "Quick Build",
    recommended: false,
    description:
      "Fast single-pass generation. Good for quick previews \u2014 you can enhance with the full engine later.",
    detail: "Typically 5\u201320 seconds",
  },
];

export function BuildModeSelector({ onSelect, disabled, tableCount }: BuildModeSelectorProps) {
  return (
    <div className="space-y-3">
      {tableCount != null && tableCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {tableCount} table{tableCount !== 1 ? "s" : ""} selected
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {modes.map(({ mode, icon: Icon, title, recommended, description, detail }) => (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(mode)}
            className={`group relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-all hover:shadow-md disabled:pointer-events-none disabled:opacity-50 ${
              recommended
                ? "border-primary/40 bg-primary/[0.03] hover:border-primary"
                : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={`size-4 ${recommended ? "text-primary" : "text-muted-foreground"}`}
              />
              <span className="text-sm font-semibold">{title}</span>
              {recommended && (
                <Badge
                  variant="secondary"
                  className="ml-auto text-[10px] px-1.5 py-0 leading-4 bg-primary/10 text-primary"
                >
                  Recommended
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            <p className="mt-auto text-[10px] text-muted-foreground/70">{detail}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
