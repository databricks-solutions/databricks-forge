"use client";

import { Target, Pencil, X, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

interface IndustryOption {
  id: string;
  name: string;
}

export function IndustryBanner({
  outcome,
  industryEditing,
  industrySaving,
  outcomesLoading,
  industryId,
  industryAutoDetected,
  isCompleted,
  useCasesLength,
  getOptions,
  onAssign,
  onEdit,
  onCancelEdit,
}: {
  outcome: IndustryOutcome | null;
  industryEditing: boolean;
  industrySaving: boolean;
  outcomesLoading: boolean;
  industryId: string | null;
  industryAutoDetected: boolean;
  isCompleted: boolean;
  useCasesLength: number;
  getOptions: () => IndustryOption[];
  onAssign: (industryId: string | null) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  if (industryEditing) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/30">
        <Target className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="flex-1">
          <p className="mb-2 text-sm font-medium text-violet-900 dark:text-violet-200">
            {outcome ? "Change" : "Assign"} Industry Outcome Map
          </p>
          <Select
            defaultValue={industryId || ""}
            onValueChange={(v) => onAssign(v || null)}
            disabled={industrySaving || outcomesLoading}
          >
            <SelectTrigger className="w-full max-w-sm bg-white dark:bg-background">
              <SelectValue placeholder="Select an industry..." />
            </SelectTrigger>
            <SelectContent>
              {getOptions().map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {industrySaving ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
        ) : (
          <div className="flex shrink-0 gap-1">
            {outcome && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => onAssign(null)}
              >
                Remove
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancelEdit}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/30">
        <Target className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-violet-900 dark:text-violet-200">
            Matched Industry Outcome Map: <span className="font-semibold">{outcome.name}</span>
          </p>
          <p className="text-xs text-violet-700 dark:text-violet-400">
            {industryAutoDetected
              ? "Automatically detected from business context"
              : "Manually selected"}
            {" \u2022 "}
            {outcome.objectives.length} strategic objective
            {outcome.objectives.length !== 1 ? "s" : ""}
            {" \u2022 "}
            {outcome.objectives.reduce((sum, o) => sum + o.priorities.length, 0)} priorities
            {" \u2022 "}
            {outcome.objectives.reduce(
              (sum, o) => sum + o.priorities.reduce((s, p) => s + p.useCases.length, 0),
              0,
            )}{" "}
            reference use cases
          </p>
        </div>
        {industryAutoDetected && (
          <Badge
            variant="outline"
            className="shrink-0 border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-400"
          >
            auto-detected
          </Badge>
        )}
        {isCompleted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Change industry outcome map</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  if (isCompleted && useCasesLength > 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/20">
        <Target className="h-5 w-5 shrink-0 text-violet-400 dark:text-violet-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-violet-800 dark:text-violet-300">
            No industry outcome map detected
          </p>
          <p className="text-xs text-violet-600 dark:text-violet-500">
            Assign one to unlock coverage analysis, gap report, and strategic priority mapping for
            your use cases.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950"
          onClick={onEdit}
        >
          <Target className="mr-1.5 h-3.5 w-3.5" />
          Assign Industry
        </Button>
      </div>
    );
  }

  return null;
}
