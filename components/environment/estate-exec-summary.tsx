"use client";

/**
 * C-level exec summary for an estate program. Headline numbers + asset
 * inventory + readiness + a plain-language narrative. Deliberately light on
 * data-engineering detail — the Detail view carries the trees/tables.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Boxes,
  Network,
  BrainCircuit,
  LayoutDashboard,
  MessagesSquare,
  FunctionSquare,
  HardDrive,
} from "lucide-react";

export interface ExecSummaryData {
  totalTables: number;
  totalSizeBytes: string; // bigint-as-string
  domainCount: number;
  entityCount: number;
  readinessScore: number | null;
  readiness: "ready" | "needs_work" | "missing" | null;
  assets: {
    models: number;
    functions: number;
    genieSpaces: number;
    dashboards: number;
    metricViews: number;
  };
  tier: { bronze: number; silver: number; gold: number; system: number; unknown: number };
  coverage: {
    tablesWithCommentPct: number;
    tablesWithOwnerPct: number;
    tablesWithTierPct: number;
  };
  scanCount: number;
}

function formatBytes(bytesStr: string): string {
  const n = Number(bytesStr);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function Hero({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function readinessLabel(band: ExecSummaryData["readiness"]): string {
  if (band === "ready") return "Ready";
  if (band === "needs_work") return "Needs work";
  if (band === "missing") return "Early";
  return "—";
}

/** Plain-language headline a director can read in 5 seconds. */
function narrative(d: ExecSummaryData): string[] {
  const lines: string[] = [];
  const a = d.assets;
  lines.push(
    `Across ${d.scanCount} scanned area${d.scanCount === 1 ? "" : "s"}, the estate holds ${d.totalTables.toLocaleString()} tables organised into ${d.domainCount} business domain${d.domainCount === 1 ? "" : "s"} and ${d.entityCount} canonical ${d.entityCount === 1 ? "entity" : "entities"}.`,
  );
  const aiBits: string[] = [];
  if (a.models > 0) aiBits.push(`${a.models} ML model${a.models === 1 ? "" : "s"}`);
  if (a.genieSpaces > 0) aiBits.push(`${a.genieSpaces} Genie space${a.genieSpaces === 1 ? "" : "s"}`);
  if (a.dashboards > 0) aiBits.push(`${a.dashboards} dashboard${a.dashboards === 1 ? "" : "s"}`);
  if (aiBits.length > 0) {
    lines.push(`Active analytics & AI footprint: ${aiBits.join(", ")}.`);
  } else {
    lines.push(
      "No models, Genie spaces, or dashboards were discovered in scope — an opportunity to activate analytics on this data.",
    );
  }
  const gold = d.tier.gold;
  if (d.totalTables > 0) {
    const goldPct = Math.round((gold / d.totalTables) * 100);
    lines.push(
      `${goldPct}% of tables are curated to gold tier; ${d.coverage.tablesWithOwnerPct}% have an assigned owner and ${d.coverage.tablesWithCommentPct}% are documented.`,
    );
  }
  return lines;
}

export function EstateExecSummary({ data }: { data: ExecSummaryData }) {
  const a = data.assets;
  return (
    <div className="space-y-4">
      {/* Narrative */}
      <Card className="bg-muted/30">
        <CardContent className="space-y-1.5 py-4">
          {narrative(data).map((line, i) => (
            <p key={i} className="text-sm leading-relaxed">
              {line}
            </p>
          ))}
        </CardContent>
      </Card>

      {/* Estate at a glance */}
      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          Estate at a glance
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Hero label="Tables" value={data.totalTables.toLocaleString()} icon={<Database className="h-4 w-4" />} />
          <Hero label="Data size" value={formatBytes(data.totalSizeBytes)} icon={<HardDrive className="h-4 w-4" />} />
          <Hero label="Domains" value={data.domainCount} icon={<Network className="h-4 w-4" />} />
          <Hero
            label="Readiness"
            value={data.readinessScore != null ? `${data.readinessScore}` : "—"}
            icon={<Boxes className="h-4 w-4" />}
            sub={readinessLabel(data.readiness)}
          />
        </div>
      </div>

      {/* What's deployed today — the C-level "activity" signal */}
      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
          What&apos;s deployed today
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Hero label="ML models" value={a.models} icon={<BrainCircuit className="h-4 w-4" />} />
          <Hero label="Genie spaces" value={a.genieSpaces} icon={<MessagesSquare className="h-4 w-4" />} />
          <Hero label="Dashboards" value={a.dashboards} icon={<LayoutDashboard className="h-4 w-4" />} />
          <Hero label="Metric views" value={a.metricViews} icon={<Boxes className="h-4 w-4" />} />
          <Hero label="UC functions" value={a.functions} icon={<FunctionSquare className="h-4 w-4" />} />
        </div>
      </div>

      {/* Tier mix + quality */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Medallion tier mix</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">Gold {data.tier.gold}</Badge>
            <Badge variant="outline">Silver {data.tier.silver}</Badge>
            <Badge variant="outline">Bronze {data.tier.bronze}</Badge>
            <Badge variant="outline">System {data.tier.system}</Badge>
            <Badge variant="outline">Untiered {data.tier.unknown}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Governance readiness</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Documented</div>
              <div className="text-lg font-semibold">{data.coverage.tablesWithCommentPct}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Owned</div>
              <div className="text-lg font-semibold">{data.coverage.tablesWithOwnerPct}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Tiered</div>
              <div className="text-lg font-semibold">{data.coverage.tablesWithTierPct}%</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
