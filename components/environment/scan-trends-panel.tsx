"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

export function ScanTrendsPanel() {
  const [trends, setTrends] = useState<{
    metrics: Array<{
      label: string;
      previous: number | string;
      current: number | string;
      changeLabel: string;
      direction: "up" | "down" | "stable";
      sentiment: "positive" | "negative" | "neutral";
    }>;
    newTables: string[];
    removedTables: string[];
    daysBetween: number;
    previous: { scanId: string; createdAt: string };
    current: { scanId: string; createdAt: string };
  } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/environment/trends");
        if (!res.ok) return;
        const json = await res.json();
        if (json.hasTrends) {
          setTrends(json.trends);
        }
      } catch {
        // silent
      }
    }
    load();
  }, []);

  if (!trends) return null;

  const sentimentColor = {
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
    neutral: "text-muted-foreground",
  };
  const directionIcon = {
    up: "\u2191",
    down: "\u2193",
    stable: "\u2192",
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          Scan Trends ({trends.daysBetween} days between scans)
          {trends.newTables.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[10px]">
              +{trends.newTables.length} new tables
            </Badge>
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {trends.metrics.map((m) => (
                <div key={m.label} className="rounded-md border px-3 py-2">
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-medium">{m.current}</p>
                  <p className={`text-xs ${sentimentColor[m.sentiment]}`}>
                    {directionIcon[m.direction]} {m.changeLabel}
                  </p>
                </div>
              ))}
            </div>
            {(trends.newTables.length > 0 || trends.removedTables.length > 0) && (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {trends.newTables.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-600">
                      New Tables (+{trends.newTables.length})
                    </p>
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {trends.newTables.slice(0, 10).map((t) => (
                        <p key={t} className="truncate font-mono text-[10px]">
                          {t}
                        </p>
                      ))}
                      {trends.newTables.length > 10 && (
                        <p className="text-[10px] text-muted-foreground">
                          ... and {trends.newTables.length - 10} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {trends.removedTables.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600">
                      Removed Tables (-{trends.removedTables.length})
                    </p>
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {trends.removedTables.slice(0, 10).map((t) => (
                        <p key={t} className="truncate font-mono text-[10px]">
                          {t}
                        </p>
                      ))}
                      {trends.removedTables.length > 10 && (
                        <p className="text-[10px] text-muted-foreground">
                          ... and {trends.removedTables.length - 10} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
