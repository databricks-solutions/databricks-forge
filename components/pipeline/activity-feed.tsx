"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
  Download,
  Activity,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

interface ActivityEntry {
  activityId: string;
  userId: string | null;
  action: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  created_run: {
    icon: <Plus className="h-3.5 w-3.5" />,
    label: "Created run",
    color: "text-blue-500",
  },
  started_pipeline: {
    icon: <Play className="h-3.5 w-3.5" />,
    label: "Started pipeline",
    color: "text-violet-500",
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "Pipeline completed",
    color: "text-green-500",
  },
  failed: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: "Pipeline failed",
    color: "text-red-500",
  },
  deleted_run: {
    icon: <Trash2 className="h-3.5 w-3.5" />,
    label: "Deleted run",
    color: "text-amber-500",
  },
  exported: {
    icon: <Download className="h-3.5 w-3.5" />,
    label: "Exported",
    color: "text-teal-500",
  },
  rerun_business_value: {
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    label: "Refreshed business value",
    color: "text-indigo-500",
  },
};

function useActivities(limit: number) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities ?? []);
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return { activities, loading };
}

function ActivityList({ activities, loading }: { activities: ActivityEntry[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity recorded yet. Actions like creating runs, exporting results, and pipeline
        completions will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((a) => {
        const config = ACTION_CONFIG[a.action] ?? {
          icon: <Activity className="h-3.5 w-3.5" />,
          label: a.action,
          color: "text-muted-foreground",
        };
        const businessName =
          (a.metadata?.businessName as string) ?? (a.metadata?.format as string) ?? "";

        return (
          <div key={a.activityId} className="flex items-center gap-3 rounded-md border p-2.5">
            <div className={config.color}>{config.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-medium">{config.label}</span>
                {businessName && (
                  <span className="text-muted-foreground"> &mdash; {businessName}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {a.userId && <>{a.userId} &middot; </>}
                {new Date(a.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            {a.resourceId && a.action !== "deleted_run" && (
              <Link href={`/runs/${a.resourceId}`} className="text-xs text-primary hover:underline">
                View
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline activity list (no wrapping card) for embedding in tabs */
export function ActivityFeedInline({ limit = 10 }: { limit?: number }) {
  const { activities, loading } = useActivities(limit);
  return <ActivityList activities={activities} loading={loading} />;
}

/** Standalone collapsible activity card */
export function ActivityFeed({ limit = 10 }: { limit?: number }) {
  const { activities, loading } = useActivities(limit);

  return (
    <Collapsible defaultOpen={false}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-lg">Recent Activity</CardTitle>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-90" />
            </div>
            <CardDescription>Latest actions across the platform</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <ActivityList activities={activities} loading={loading} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
