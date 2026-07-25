"use client";

import { Checkbox } from "@/components/ui/checkbox";

export interface SharedAsset {
  fqn: string;
  usedBy: string[];
}

export interface TrashPreview {
  assets: { functions: string[]; metricViews: string[] };
  shared: { functions: SharedAsset[]; metricViews: SharedAsset[] };
  safeToDelete: { functions: string[]; metricViews: string[] };
}

export function TrashPreviewSection({
  preview,
  dropChecked,
  onDropCheckedChange,
}: {
  preview: TrashPreview;
  dropChecked: boolean;
  onDropCheckedChange: (v: boolean) => void;
}) {
  const hasSafe =
    preview.safeToDelete.functions.length > 0 || preview.safeToDelete.metricViews.length > 0;
  const hasShared = preview.shared.functions.length > 0 || preview.shared.metricViews.length > 0;
  const hasAny = hasSafe || hasShared;

  if (!hasAny) return null;

  return (
    <div className="space-y-3 text-sm">
      {hasSafe && (
        <div className="flex items-start gap-2">
          <Checkbox
            checked={dropChecked}
            onCheckedChange={(v) => onDropCheckedChange(v === true)}
            id="drop-assets"
            className="mt-0.5"
          />
          <label htmlFor="drop-assets" className="cursor-pointer leading-tight">
            Also delete deployed functions and metric views
          </label>
        </div>
      )}

      {hasSafe && dropChecked && (
        <div className="rounded border bg-destructive/5 p-2.5 space-y-1">
          <p className="text-xs font-medium text-destructive">
            Will be removed from Unity Catalog:
          </p>
          {preview.safeToDelete.functions.map((fqn) => (
            <p key={fqn} className="text-xs font-mono text-destructive/80 truncate">
              fn: {fqn}
            </p>
          ))}
          {preview.safeToDelete.metricViews.map((fqn) => (
            <p key={fqn} className="text-xs font-mono text-destructive/80 truncate">
              mv: {fqn}
            </p>
          ))}
        </div>
      )}

      {hasShared && (
        <div className="rounded border bg-amber-50 dark:bg-amber-950/20 p-2.5 space-y-1">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Shared with other spaces (will be kept):
          </p>
          {preview.shared.functions.map((s) => (
            <p
              key={s.fqn}
              className="text-xs font-mono text-amber-600 dark:text-amber-500 truncate"
            >
              fn: {s.fqn} — used by {s.usedBy.join(", ")}
            </p>
          ))}
          {preview.shared.metricViews.map((s) => (
            <p
              key={s.fqn}
              className="text-xs font-mono text-amber-600 dark:text-amber-500 truncate"
            >
              mv: {s.fqn} — used by {s.usedBy.join(", ")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
