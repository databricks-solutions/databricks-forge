"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  PieChart,
  Table2,
  Hash,
  ExternalLink,
} from "lucide-react";

interface WidgetDesign {
  type: string;
  title: string;
  datasetName: string;
}

interface DatasetDesign {
  name: string;
  displayName: string;
  sql: string;
  purpose: string;
}

interface DashboardPreviewProps {
  title: string;
  description: string;
  datasets?: DatasetDesign[];
  widgets?: WidgetDesign[];
  dashboardUrl?: string;
  isExisting?: boolean;
}

const WIDGET_ICON: Record<string, React.ReactNode> = {
  counter: <Hash className="size-3.5 text-blue-500" />,
  bar: <BarChart3 className="size-3.5 text-green-500" />,
  line: <TrendingUp className="size-3.5 text-purple-500" />,
  pie: <PieChart className="size-3.5 text-orange-500" />,
  table: <Table2 className="size-3.5 text-gray-500" />,
};

export function DashboardPreview({
  title,
  description,
  datasets = [],
  widgets = [],
  dashboardUrl,
  isExisting = false,
}: DashboardPreviewProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-4 text-primary" />
          <p className="text-sm font-medium">{title}</p>
          {isExisting && (
            <Badge variant="secondary" className="text-[10px]">
              Existing
            </Badge>
          )}
        </div>
        {dashboardUrl && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" asChild>
            <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3" />
              Open
            </a>
          </Button>
        )}
      </div>

      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      {widgets.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {widgets.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs"
            >
              {WIDGET_ICON[w.type] ?? <BarChart3 className="size-3.5" />}
              <span className="truncate">{w.title}</span>
            </div>
          ))}
        </div>
      )}

      {datasets.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">
            Datasets ({datasets.length})
          </p>
          {datasets.map((ds, i) => (
            <div key={i} className="rounded-md bg-muted/30 p-2">
              <p className="text-xs font-medium">{ds.displayName}</p>
              <pre className="mt-1 max-h-[60px] overflow-auto text-[10px] text-muted-foreground">
                {ds.sql}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
