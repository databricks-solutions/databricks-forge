/**
 * Business Value -- Data Gap deliverable surface.
 *
 * Mirrors the per-run Data Asset Coverage card from the Outcome Map tab but
 * scopes itself to the user's latest completed discovery run. Reuses the v2
 * `DataGapCard` (Master Repository v2 coverage + Sales-Ready Onboarding Plan
 * + Value-at-Risk + Excel export) so the same workbook the SA hands to the
 * customer is one click away from anywhere in the BV section.
 *
 * Empty state mirrors `/business-value/stakeholders` for consistency: when
 * the user has no completed runs we show the BV progress banner + a prompt
 * to run a discovery pipeline.
 */

import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import { getLatestCompletedRunForOwner } from "@/lib/lakebase/runs";
import { DataGapCard } from "@/components/pipeline/run-detail/data-gap-card";
import { BvProgressBanner } from "@/components/business-value/bv-progress-banner";

export const dynamic = "force-dynamic";

function DataGapSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

async function DataGapContent() {
  const user = await requireUser();
  const accessibleRunIds = await listAccessibleIds(user.email, "run");
  const latest = await getLatestCompletedRunForOwner(user.email, accessibleRunIds);

  if (!latest) {
    return (
      <div className="space-y-6">
        <BvProgressBanner runId={null} />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="max-w-xl text-muted-foreground">
              No completed discovery runs yet. Once you finish a discovery, the Sales-Ready
              Onboarding Plan and the data-asset coverage view will appear here, scoped to your
              latest run.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BvProgressBanner runId={latest.runId} />
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Showing data-gap analysis for the latest completed discovery run
        <span className="ml-1 font-medium text-foreground">{latest.businessName}</span>
        {latest.completedAt ? (
          <span className="ml-1">({new Date(latest.completedAt).toLocaleDateString()})</span>
        ) : null}
        .
      </div>
      <DataGapCard runId={latest.runId} />
    </div>
  );
}

export default function BvDataGapPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Data Gap"
        subtitle="Which upstream systems should we ingest next to unlock the most value — ranked, with the recommended Databricks path."
      />
      <Suspense fallback={<DataGapSkeleton />}>
        <DataGapContent />
      </Suspense>
    </div>
  );
}
