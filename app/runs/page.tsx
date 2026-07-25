import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { RunsContent } from "@/components/runs/runs-content";
import { listRunSummaries, type PipelineRunSummary } from "@/lib/lakebase/runs";
import { logger } from "@/lib/logger";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";

export const dynamic = "force-dynamic";

async function fetchInitialRuns(): Promise<{
  runs: PipelineRunSummary[];
  error: string | null;
}> {
  try {
    const user = await requireUser();
    const sharedIds = await listAccessibleIds(user.email, "run");
    // Lean summary view -- avoids shipping multi-MB `businessContext` /
    // `stepLog` / `synthesisJson` through the RSC boundary just to render
    // a table that uses ~8 columns.
    const runs = await listRunSummaries(200, 0, user.email, "all", sharedIds);
    return { runs, error: null };
  } catch (err) {
    logger.error("[runs] Failed to fetch initial runs", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { runs: [], error: "Failed to load runs" };
  }
}

function RunsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

async function RunsData() {
  const { runs, error } = await fetchInitialRuns();
  return <RunsContent initialRuns={runs} initialError={error} />;
}

export default function RunsPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Pipeline Runs"
        subtitle="View and manage your discovery pipeline runs"
        actions={
          <Button asChild>
            <Link href="/configure">
              <Plus className="mr-2 h-4 w-4" />
              New Discovery
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<RunsSkeleton />}>
        <RunsData />
      </Suspense>
    </div>
  );
}
