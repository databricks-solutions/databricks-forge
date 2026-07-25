"use client";

import { Zap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PbiResultBanner({
  overlapCount,
  total,
  onDismiss,
}: {
  overlapCount: number;
  total: number;
  onDismiss: () => void;
}) {
  return (
    <Card className="border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20">
      <CardContent className="flex items-center gap-3 py-3">
        <Zap className="h-5 w-5 text-violet-500" />
        <div>
          <p className="text-sm font-medium">Power BI enrichment complete</p>
          <p className="text-xs text-muted-foreground">
            {overlapCount} of {total} use cases overlap with PBI assets
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
