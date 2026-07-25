"use client";

import { Button } from "@/components/ui/button";

interface GenieSelectionBarProps {
  selectedCount: number;
  onDeselectAll: () => void;
  onDeploy: () => void;
}

export function GenieSelectionBar({
  selectedCount,
  onDeselectAll,
  onDeploy,
}: GenieSelectionBarProps) {
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-lg border bg-background p-3 shadow-lg">
      <span className="text-sm font-medium">
        {selectedCount} space{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onDeselectAll}>
          Deselect All
        </Button>
        <Button size="sm" onClick={onDeploy} className="bg-green-600 hover:bg-green-700">
          Deploy Selected ({selectedCount})
        </Button>
      </div>
    </div>
  );
}
