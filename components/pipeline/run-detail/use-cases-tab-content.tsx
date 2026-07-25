"use client";

import { Card, CardContent } from "@/components/ui/card";
import { UseCaseTable } from "@/components/pipeline/use-case-table";
import type { UseCase } from "@/lib/domain/types";

export function UseCasesTabContent({
  useCases,
  lineageDiscoveredFqns,
  runId,
  onUpdate,
  highlightUseCaseId,
}: {
  useCases: UseCase[];
  lineageDiscoveredFqns: string[];
  runId?: string;
  onUpdate: (updated: UseCase) => Promise<{ ok: boolean; error?: string }>;
  highlightUseCaseId?: string;
}) {
  if (useCases.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">No use cases were generated.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <UseCaseTable
      useCases={useCases}
      lineageDiscoveredFqns={lineageDiscoveredFqns}
      onUpdate={onUpdate}
      highlightUseCaseId={highlightUseCaseId}
      runId={runId}
    />
  );
}
