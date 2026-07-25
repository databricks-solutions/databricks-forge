import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import {
  DashboardContent,
  type DashboardStats,
} from "@/components/dashboard/dashboard-content";
import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/auth/route-user";
import { listAccessibleIds } from "@/lib/lakebase/acl";
import {
  getDashboardStats,
  listDashboardRunOptions,
  type DashboardRunOption,
} from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

async function fetchInitialDashboard(): Promise<{
  stats: DashboardStats | null;
  runs: DashboardRunOption[];
  selectedRunId: string | null;
  error: string | null;
}> {
  try {
    const user = await requireUser();
    const accessibleRunIds = await listAccessibleIds(user.email, "run");

    const runs = await listDashboardRunOptions(user.email, accessibleRunIds);
    const selectedRunId = runs[0]?.runId ?? null;

    const stats = await getDashboardStats({
      userEmail: user.email,
      sharedRunIds: accessibleRunIds,
      runId: selectedRunId,
    });

    return { stats, runs, selectedRunId, error: null };
  } catch (err) {
    logger.error("[dashboard] Failed to fetch stats", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      stats: null,
      runs: [],
      selectedRunId: null,
      error: "Failed to load dashboard stats",
    };
  }
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Run selector */}
      <Skeleton className="h-12 w-full max-w-md rounded-xl" />
      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      {/* Quick actions */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <Skeleton className="h-20 flex-1 rounded-xl" />
        <Skeleton className="h-20 flex-1 rounded-xl" />
        <Skeleton className="h-20 flex-1 rounded-xl" />
      </div>
      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
      {/* Recent runs + Activity */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-xl lg:col-span-3" />
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}

async function DashboardData() {
  const { stats, runs, selectedRunId, error } = await fetchInitialDashboard();
  return (
    <DashboardContent
      initialStats={stats}
      initialError={error}
      runs={runs}
      initialRunId={selectedRunId}
    />
  );
}

function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-accent/30 dark:from-card dark:via-card dark:to-primary/5">
      {/* Geometric texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 5L55 20V40L30 55L5 40V20L30 5Z' fill='none' stroke='%23FF3621' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 60px",
        }}
      />
      <div className="relative flex items-center justify-between gap-6 px-8 py-10 sm:px-10 sm:py-12">
        <div className="flex items-center gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 shadow-sm ring-1 ring-primary/10">
            <Image
              src="/databricks-icon.svg"
              alt="Databricks"
              width={32}
              height={34}
              className="shrink-0"
            />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Forge</h1>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground sm:text-base">
              Transform Unity Catalog metadata into scored, actionable use cases.
            </p>
          </div>
        </div>
        <Button size="lg" className="hidden shrink-0 sm:inline-flex" asChild>
          <Link href="/configure">
            <Plus className="mr-2 h-4 w-4" />
            New Discovery
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <HeroBanner />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardData />
      </Suspense>
    </div>
  );
}
