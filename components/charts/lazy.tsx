import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const ChartSkeleton = () => <Skeleton className="h-64 w-full rounded-xl" />;

export const ScoreDistributionChart = dynamic(
  () => import("./score-distribution-chart").then((m) => m.ScoreDistributionChart),
  { loading: ChartSkeleton, ssr: false },
);

export const DomainBreakdownChart = dynamic(
  () => import("./domain-breakdown-chart").then((m) => m.DomainBreakdownChart),
  { loading: ChartSkeleton, ssr: false },
);

export const TypeSplitChart = dynamic(
  () => import("./type-split-chart").then((m) => m.TypeSplitChart),
  { loading: ChartSkeleton, ssr: false },
);

export const StepDurationChart = dynamic(
  () => import("./step-duration-chart").then((m) => m.StepDurationChart),
  { loading: ChartSkeleton, ssr: false },
);

export const ScoreRadarChart = dynamic(
  () => import("./score-radar-chart").then((m) => m.ScoreRadarChart),
  { loading: ChartSkeleton, ssr: false },
);

export const ScoreRadarOverview = dynamic(
  () => import("./score-radar-overview").then((m) => m.ScoreRadarOverview),
  { loading: ChartSkeleton, ssr: false },
);
