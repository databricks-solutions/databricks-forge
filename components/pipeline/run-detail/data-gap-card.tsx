"use client";

/**
 * Data Gap Card -- Master Repository v2 data-asset coverage view.
 *
 * Renders the output of `/api/runs/[runId]/data-gap` (DataGapResult):
 *   - Coverage ring + MC/VA tallies + economic value-at-risk
 *   - Per-asset coverage table with ingestion recommendation
 *   - Top blocked-asset value-at-risk breakdown
 *
 * Sits beside the existing OutcomeMap (use-case-level) coverage card so the
 * two views are visible side by side.
 */

import Image from "next/image";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  DollarSign,
  Download,
  Layers,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import type {
  AssetCoverage,
  AssetValueAtRisk,
  DataGapResult,
} from "@/lib/engines/data-gap-analysis/types";
import {
  buildOnboardingPlan,
  type OnboardingPlanRow,
} from "@/lib/engines/data-gap-analysis/onboarding-plan";

function fmtUsd(n: number): string {
  if (!n) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const STRATEGY_LABEL: Record<string, string> = {
  lakeflow_connect: "Lakeflow Connect",
  uc_federation: "UC Federation",
  lakebridge_migrate: "Lakebridge Migrate",
  bespoke: "Bespoke",
};

// Ingestion strategies that resolve to a Databricks product. `bespoke` is
// customer-built (not Databricks), and any unknown strategy is treated as
// not-a-product so the icon doesn't render false-positives.
const DATABRICKS_STRATEGIES = new Set<string>([
  "lakeflow_connect",
  "uc_federation",
  "lakebridge_migrate",
]);

function StrategyLabel({ strategy }: { strategy: string }) {
  const label = STRATEGY_LABEL[strategy] ?? strategy;
  const isDatabricks = DATABRICKS_STRATEGIES.has(strategy);
  return (
    <span className="inline-flex items-center gap-1.5">
      {isDatabricks ? (
        <Image
          src="/databricks-icon.svg"
          alt="Databricks"
          width={12}
          height={12}
          className="shrink-0"
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

export function DataGapCard({ runId }: { runId: string }) {
  const [result, setResult] = useState<DataGapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/data-gap`, {
        method: force ? "POST" : "GET",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        setResult(null);
      } else {
        const body = (await res.json()) as { result: DataGapResult };
        setResult(body.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-violet-500" /> Data Asset Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Computing data gap analysis...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-violet-500" /> Data Asset Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error ?? "No data gap analysis available."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-violet-500" /> Data Asset Coverage --{" "}
            {result.industryName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                window.location.href = `/api/runs/${runId}/data-gap/export`;
              }}
              disabled={refreshing || !result}
              title="Download Sales-Ready Onboarding Plan (Excel)"
            >
              <Download className="mr-1 h-4 w-4" /> Onboarding Plan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SummaryStrip result={result} />
        <OnboardingPlanPanel result={result} />
        <CoverageMatrix coverage={result.coverage} />
        {result.valueAtRisk.length > 0 && (
          <ValueAtRiskTable rows={result.valueAtRisk} coverage={result.coverage} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sales-Ready Onboarding Plan panel
// ---------------------------------------------------------------------------

/**
 * Headline panel: tells Sales / SAs WHICH source system to onboard next
 * (and what dollars and use cases that unlocks). Built deterministically
 * from the per-asset Value-at-Risk + resolved source systems, so the
 * panel is auto-derived from the existing engine output — no extra LLM
 * calls, no extra storage.
 */
function OnboardingPlanPanel({ result }: { result: DataGapResult }) {
  const plan = useMemo(() => buildOnboardingPlan(result), [result]);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (plan.length === 0) return null;
  const top = plan.slice(0, 6);
  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Sales-Ready Onboarding Plan</h3>
          <p className="text-xs text-muted-foreground">
            Each row is an upstream system to chase down. Confirm the owner with the customer,
            then onboard it to Databricks via the recommended path to unlock the listed use
            cases and value.
          </p>
        </div>
      </div>
      <OriginLegend />
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-6 px-3 py-2" />
              <th className="px-3 py-2 text-left">Source System</th>
              <th className="px-3 py-2 text-left">Recommended Path</th>
              <th className="px-3 py-2 text-right">Assets Unlocked</th>
              <th className="px-3 py-2 text-right">Use Cases Unlocked</th>
              <th className="px-3 py-2 text-right">Annual Unlock Value</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row) => {
              const expandable =
                row.assets.length > 0 ||
                row.useCases.length > 0 ||
                (row.origin === "unknown" && (row.likelyCategories?.length ?? 0) > 0);
              const isOpen = expanded === row.systemName;
              return (
                <Fragment key={row.systemName}>
                  <tr
                    className={`border-t ${expandable ? "cursor-pointer hover:bg-muted/40" : ""}`}
                    onClick={() => {
                      if (!expandable) return;
                      setExpanded(isOpen ? null : row.systemName);
                    }}
                  >
                    <td className="w-6 px-3 py-2">
                      {expandable ? (
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.systemName}</span>
                        <OriginBadge origin={row.origin} />
                      </div>
                      {row.origin === "master-repo" &&
                        row.exampleVendors &&
                        row.exampleVendors.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            e.g. {row.exampleVendors.slice(0, 3).join(", ")}
                          </div>
                        )}
                      {row.origin === "unknown" && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Ask the customer which systems own these assets.
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.preferredStrategy ? (
                        <span
                          className="inline-flex items-center"
                          title={
                            row.origin === "master-repo"
                              ? "Typical onboarding path for this category. Final connector depends on the actual vendor — confirm with the customer."
                              : row.origin === "lineage"
                                ? "Recommended path for the specific vendor we detected in your lineage."
                                : undefined
                          }
                        >
                          <Badge variant="outline">
                            <StrategyLabel strategy={row.preferredStrategy} />
                          </Badge>
                          {row.origin === "master-repo" && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              (typical for category)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Confirm source with customer
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.assetCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.useCaseCount}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {fmtUsd(row.valueMid)}
                      <div className="text-xs text-muted-foreground">
                        {fmtUsd(row.valueLow)} -- {fmtUsd(row.valueHigh)}
                      </div>
                    </td>
                  </tr>
                  {expandable && isOpen && (
                    <tr className="border-t bg-muted/20">
                      <td />
                      <td colSpan={5} className="px-3 py-3">
                        <OnboardingPlanDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Compact one-line legend for the three Origin badges. Replaces the
 * hover-only tooltips so a Sales person scanning the panel for the first
 * time understands the confidence model without mousing over anything.
 */
function OriginLegend() {
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">Confidence:</span>{" "}
      <Badge variant="default" className="mr-0.5">
        Lineage
      </Badge>{" "}
      confirmed from your workspace lineage ·{" "}
      <Badge variant="secondary" className="mr-0.5">
        Ref Arch
      </Badge>{" "}
      inferred from the industry reference architecture (vendor not verified) ·{" "}
      <Badge variant="outline" className="mr-0.5">
        Unconfirmed
      </Badge>{" "}
      no signal yet — confirm the source with the customer.
    </p>
  );
}

function OriginBadge({ origin }: { origin: OnboardingPlanRow["origin"] }) {
  if (origin === "lineage") {
    return (
      <Badge variant="default" title="Confirmed from upstream lineage in this workspace">
        Lineage
      </Badge>
    );
  }
  if (origin === "master-repo") {
    return (
      <Badge
        variant="secondary"
        title="Inferred from the industry reference architecture. The vendor is NOT verified -- confirm with the customer which one they run."
      >
        Ref Arch
      </Badge>
    );
  }
  return (
    <Badge variant="outline" title="No source signal detected -- confirm with the customer">
      Unconfirmed
    </Badge>
  );
}

function OnboardingPlanDetail({ row }: { row: OnboardingPlanRow }) {
  return (
    <div className="space-y-3 text-xs">
      {row.origin === "master-repo" &&
        row.exampleVendors &&
        row.exampleVendors.length > 0 && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground">
              Common vendors in this category
            </div>
            <div className="flex flex-wrap gap-1">
              {row.exampleVendors.map((v) => (
                <Badge key={v} variant="secondary">
                  {v}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ask the customer which one they run so we can pick the right Lakeflow connector.
            </p>
          </div>
        )}
      {row.origin === "unknown" &&
        row.likelyCategories &&
        row.likelyCategories.length > 0 && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground">
              Likely categories (based on the missing assets)
            </div>
            <div className="flex flex-wrap gap-1">
              {row.likelyCategories.map((k) => (
                <Badge key={k} variant="outline">
                  {k}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Use these as discovery prompts — ask the customer which systems own this kind of
              data so we can confirm the ingestion path.
            </p>
          </div>
        )}
      {row.assets.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">
            Top assets unlocked
          </div>
          <ul className="space-y-1">
            {row.assets.map((a) => (
              <li
                key={a.assetId}
                className="flex items-center justify-between gap-2 rounded-sm bg-background px-2 py-1"
              >
                <span>
                  <span className="font-medium">{a.assetId}</span>: {a.assetName}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtUsd(a.valueMid)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {row.useCases.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">
            Use cases unlocked ({row.useCaseCount} total)
          </div>
          <div className="flex flex-wrap gap-1">
            {row.useCases.map((uc) => (
              <Badge key={uc} variant="outline">
                {uc}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ result }: { result: DataGapResult }) {
  const { summary } = result;
  const mcPct = Math.round(summary.mcCoveragePct * 100);
  const colorClass =
    mcPct >= 75
      ? "text-green-600 dark:text-green-400"
      : mcPct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Tile
        icon={<ShieldAlert className="h-4 w-4 text-violet-500" />}
        label="MC Coverage"
        value={`${mcPct}%`}
        valueClass={colorClass}
        sub={`${summary.mcCovered} / ${summary.mcCovered + summary.mcMissing} MC requirements met`}
      />
      <Tile
        icon={<Database className="h-4 w-4 text-blue-500" />}
        label="Assets Present"
        value={`${summary.presentAssets} / ${summary.totalAssets}`}
        sub={`${summary.missingAssets} missing`}
      />
      <Tile
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        label="VA Coverage"
        value={`${summary.vaCovered} / ${summary.vaCovered + summary.vaMissing}`}
        sub="Value-Add data assets"
      />
      <Tile
        icon={<DollarSign className="h-4 w-4 text-amber-500" />}
        label="Value at Risk (annual)"
        value={fmtUsd(summary.valueAtRiskMid)}
        sub={
          summary.valueAtRiskMid > 0
            ? `${fmtUsd(summary.valueAtRiskLow)} -- ${fmtUsd(summary.valueAtRiskHigh)}`
            : "Run Business Value first"
        }
      />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 text-lg font-semibold ${valueClass ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage matrix
// ---------------------------------------------------------------------------

function CoverageMatrix({ coverage }: { coverage: AssetCoverage[] }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => coverage.slice(), [coverage]);
  const visible = showAll ? sorted : sorted.slice(0, 12);
  const missing = coverage.filter((c) => !c.present);
  const presentRatio = coverage.length
    ? (coverage.length - missing.length) / coverage.length
    : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Per-Asset Coverage</h3>
        <span className="text-xs text-muted-foreground">
          {coverage.length - missing.length} present, {missing.length} missing
        </span>
      </div>
      <Progress value={presentRatio * 100} className="h-1.5" />
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-left">Family</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">MC UCs</th>
              <th className="px-3 py-2 text-left">Recommended Path</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const masterRepoSource = c.resolvedSourceSystems?.find(
                (s) => s.origin === "master-repo" && s.exampleVendors && s.exampleVendors.length > 0,
              );
              return (
              <tr key={c.assetId} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {c.assetId}: {c.assetName}
                  </div>
                  {c.systemLocation && (
                    <div className="text-xs text-muted-foreground">{c.systemLocation}</div>
                  )}
                  {masterRepoSource && masterRepoSource.exampleVendors && (
                    <div className="text-[10px] text-muted-foreground">
                      e.g. {masterRepoSource.exampleVendors.slice(0, 3).join(", ")}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{c.assetFamily}</td>
                <td className="px-3 py-2">
                  {c.present ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Present ({c.matchedTables.length})
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                    >
                      <AlertTriangle className="h-3 w-3" /> Missing
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.mcUseCaseCount > 0 ? (
                    <span title={c.mcUseCaseNames.join("\n")}>{c.mcUseCaseCount}</span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.recommendations[0] && c.recommendations[0].rating === "High" ? (
                    <span className="font-medium">
                      <StrategyLabel strategy={c.recommendations[0].strategy} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No high-confidence path</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {coverage.length > 12 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll((v) => !v)}
          className="w-full justify-center"
        >
          {showAll ? "Show fewer" : `Show all ${coverage.length} assets`}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value-at-risk table
// ---------------------------------------------------------------------------

function ValueAtRiskTable({
  rows,
  coverage,
}: {
  rows: AssetValueAtRisk[];
  coverage: AssetCoverage[];
}) {
  const top = rows.slice(0, 8);
  const [expanded, setExpanded] = useState<string | null>(null);
  const coverageById = new Map(coverage.map((c) => [c.assetId, c]));
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Top Missing Assets by Value at Risk</h3>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-6 px-3 py-2" />
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-left">Source System</th>
              <th className="px-3 py-2 text-left">Blocked UCs</th>
              <th className="px-3 py-2 text-right">Annual Value</th>
              <th className="px-3 py-2 text-left">Top Impact Category</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row) => {
              const topCat = Object.entries(row.byImpactCategory).sort(
                (a, b) => (b[1]?.mid ?? 0) - (a[1]?.mid ?? 0),
              )[0];
              const expandable = row.impactedUseCases.length > 0;
              const isOpen = expanded === row.assetId;
              const cov = coverageById.get(row.assetId);
              return (
                <Fragment key={row.assetId}>
                  <tr
                    className={`border-t ${expandable ? "cursor-pointer hover:bg-muted/40" : ""}`}
                    onClick={() => {
                      if (!expandable) return;
                      setExpanded(isOpen ? null : row.assetId);
                    }}
                  >
                    <td className="w-6 px-3 py-2">
                      {expandable ? (
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {row.assetId}: {row.assetName}
                      </div>
                      {row.reducedUseCases.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          + {row.reducedUseCases.length} reduced (VA only)
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <SourceSystemChips
                        systems={cov?.resolvedSourceSystems ?? []}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.blockedUseCases.length > 0 ? (
                        <span title={row.blockedUseCases.join("\n")}>
                          {row.blockedUseCases.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {fmtUsd(row.totalMid)}
                      <div className="text-xs text-muted-foreground">
                        {fmtUsd(row.totalLow)} -- {fmtUsd(row.totalHigh)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {topCat ? (
                        <Badge variant="secondary">{topCat[0]}</Badge>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                  </tr>
                  {expandable && isOpen && (
                    <tr className="border-t bg-muted/20">
                      <td />
                      <td colSpan={5} className="px-3 py-3">
                        <ImpactedUseCaseList impacted={row.impactedUseCases} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders the resolved source-system attribution(s) for a missing asset
 * as colored chips. Origin drives the chip color so Sales can tell at a
 * glance whether the attribution is confirmed by lineage or only inferred
 * from the reference architecture. For `master-repo` chips we render the
 * category name with a muted "e.g. <examples>" subtitle so the chip
 * doesn't pretend to know which specific vendor the customer uses.
 */
function SourceSystemChips({
  systems,
}: {
  systems: ReadonlyArray<{
    name: string;
    origin: "lineage" | "master-repo" | "unknown";
    exampleVendors?: string[];
  }>;
}) {
  if (systems.length === 0) {
    return <span className="text-muted-foreground">--</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {systems.map((s) => {
        const variant: "default" | "secondary" | "outline" =
          s.origin === "lineage" ? "default" : s.origin === "master-repo" ? "secondary" : "outline";
        const title =
          s.origin === "lineage"
            ? "Confirmed from upstream lineage in this workspace"
            : s.origin === "master-repo"
              ? "Inferred from the industry reference architecture — vendor is not verified"
              : "No source signal detected — confirm with the customer";
        return (
          <div key={`${s.name}-${s.origin}`} className="flex flex-col gap-0.5">
            <Badge variant={variant} title={title} className="w-fit">
              {s.name}
            </Badge>
            {s.origin === "master-repo" && s.exampleVendors && s.exampleVendors.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                e.g. {s.exampleVendors.slice(0, 3).join(", ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ImpactedUseCaseList({
  impacted,
}: {
  impacted: AssetValueAtRisk["impactedUseCases"];
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Impacted use cases ({impacted.length})
      </p>
      <div className="overflow-hidden rounded-md border bg-background/50">
        <table className="w-full text-xs">
          <tbody>
            {impacted.map((u, i) => (
              <tr key={`${u.useCaseId ?? u.name}-${i}`} className="border-b last:border-b-0">
                <td className="px-3 py-1.5">
                  <Badge
                    variant="outline"
                    className={
                      u.criticality === "MC"
                        ? "border-red-500/30 text-red-700 dark:text-red-400"
                        : "border-amber-500/30 text-amber-700 dark:text-amber-400"
                    }
                  >
                    {u.criticality}
                  </Badge>
                </td>
                <td className="px-3 py-1.5 text-foreground">{u.name}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                  {u.valueMid > 0 ? fmtUsd(u.valueMid) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {u.valueLow > 0 || u.valueHigh > 0
                    ? `${fmtUsd(u.valueLow)} – ${fmtUsd(u.valueHigh)}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
