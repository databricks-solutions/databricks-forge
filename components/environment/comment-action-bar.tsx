"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, AlertTriangle, Undo2 } from "lucide-react";

interface CommentActionBarProps {
  acceptedCount: number;
  appliedCount: number;
  failedCount: number;
  totalCount: number;
  applying: boolean;
  onApplyAll: () => void;
  onUndoAll: () => void;
}

export function CommentActionBar({
  acceptedCount,
  appliedCount,
  failedCount,
  totalCount,
  applying,
  onApplyAll,
  onUndoAll,
}: CommentActionBarProps) {
  if (acceptedCount === 0 && appliedCount === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          {acceptedCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            >
              <Check className="mr-1 h-3 w-3" />
              {acceptedCount} ready to apply
            </Badge>
          )}
          {appliedCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            >
              {appliedCount} applied
            </Badge>
          )}
          {failedCount > 0 && (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {failedCount} failed
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {acceptedCount + appliedCount + failedCount} of {totalCount} total
          </span>
        </div>

        <div className="flex items-center gap-2">
          {appliedCount > 0 && (
            <Button variant="outline" size="sm" onClick={onUndoAll}>
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              Undo All
            </Button>
          )}
          {acceptedCount > 0 && (
            <Button size="sm" onClick={onApplyAll} disabled={applying}>
              {applying ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Apply {acceptedCount} Comments
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
