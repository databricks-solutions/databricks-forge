"use client";

/**
 * Master Repo Reference Data Assets section -- rendered inside the outcomes
 * browser detail view for an industry. Shows the canonical taxonomy of
 * reference data assets and a compact list of mapped Master Repo use cases,
 * with MC/VA criticality aggregated across all use cases that reference each
 * asset.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Database, Server, BookOpen } from "lucide-react";
import type {
  ReferenceDataAsset,
  MasterRepoUseCase,
} from "@/lib/domain/industry-outcomes/master-repo-types";

interface MasterRepoEnrichmentResponse {
  industryId: string;
  useCases: MasterRepoUseCase[];
  dataAssets: ReferenceDataAsset[];
  provenance?: {
    generatedByModel: string | null;
    generatedAt: string | null;
  };
}

const STRATEGY_LABEL = {
  lakeflow: "Lakeflow Connect",
  federation: "UC Federation",
  lakebridge: "Lakebridge Migrate",
  bespoke: "Bespoke",
} as const;

function pickStrategy(asset: ReferenceDataAsset): keyof typeof STRATEGY_LABEL | null {
  if (asset.lakeflowConnect === "High") return "lakeflow";
  if (asset.ucFederation === "High") return "federation";
  if (asset.lakebridgeMigrate === "High") return "lakebridge";
  if (asset.bespoke === "High") return "bespoke";
  return null;
}

function buildAssetCriticality(
  useCases: MasterRepoUseCase[],
): Record<string, { mc: number; va: number; criticality: "MC" | "VA" | null }> {
  const map: Record<string, { mc: number; va: number; criticality: "MC" | "VA" | null }> = {};
  for (const uc of useCases) {
    const crit = uc.dataAssetCriticality ?? {};
    for (const [assetId, role] of Object.entries(crit)) {
      if (!map[assetId]) map[assetId] = { mc: 0, va: 0, criticality: null };
      if (role === "MC") map[assetId].mc += 1;
      else if (role === "VA") map[assetId].va += 1;
    }
  }
  for (const v of Object.values(map)) {
    v.criticality = v.mc > 0 ? "MC" : v.va > 0 ? "VA" : null;
  }
  return map;
}

export function MasterRepoSection({ industryId }: { industryId: string }) {
  const [data, setData] = useState<MasterRepoEnrichmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/master-repo/${encodeURIComponent(industryId)}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) {
              setData(null);
              setLoading(false);
            }
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as MasterRepoEnrichmentResponse;
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [industryId]);

  const criticality = useMemo(
    () => (data ? buildAssetCriticality(data.useCases) : {}),
    [data],
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-violet-500" /> Master Repository v2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    if (error) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-violet-500" /> Master Repository v2
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const families = Array.from(new Set(data.dataAssets.map((a) => a.assetFamily))).sort();
  const ucCount = data.useCases.length;
  const mcAssetCount = Object.values(criticality).filter((v) => v.criticality === "MC").length;
  const vaAssetCount = Object.values(criticality).filter((v) => v.criticality === "VA").length;
  const visibleUseCases = showAll ? data.useCases : data.useCases.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-violet-500" /> Master Repository v2
        </CardTitle>
        <CardDescription>
          {data.dataAssets.length} reference data assets ({mcAssetCount} mission-critical,{" "}
          {vaAssetCount} value-added) across {families.length} asset famil
          {families.length === 1 ? "y" : "ies"} \u00b7 {ucCount} mapped use cases.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Reference Data Assets grouped by family */}
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Database className="h-4 w-4 text-blue-500" /> Reference Data Assets
          </h3>
          <div className="space-y-3">
            {families.map((family) => {
              const items = data.dataAssets.filter((a) => a.assetFamily === family);
              return (
                <div key={family} className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{family}</p>
                    <span className="text-xs text-muted-foreground">
                      {items.length} asset{items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {items.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        criticality={criticality[asset.id]?.criticality ?? null}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Mapped Master Repo Use Cases */}
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4 text-emerald-500" /> Use Cases (Master Repo)
          </h3>
          <div className="space-y-2">
            {visibleUseCases.map((uc) => (
              <MasterRepoUseCaseRow key={uc.name} useCase={uc} />
            ))}
          </div>
          {ucCount > 8 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${ucCount} use cases`}
            </Button>
          )}
        </div>

        {/* Provenance footer -- only renders when this enrichment was
            LLM-generated via the demo wizard / outcome-map generator. */}
        {data.provenance &&
          (data.provenance.generatedByModel || data.provenance.generatedAt) && (
            <div className="flex items-center gap-2 pt-2 text-[11px] text-muted-foreground">
              <span>
                Generated by{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {data.provenance.generatedByModel ?? "(unknown model)"}
                </code>
                {data.provenance.generatedAt
                  ? ` · ${new Date(data.provenance.generatedAt).toLocaleString()}`
                  : null}
              </span>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function AssetRow({
  asset,
  criticality,
}: {
  asset: ReferenceDataAsset;
  criticality: "MC" | "VA" | null;
}) {
  const strategy = pickStrategy(asset);
  return (
    <li className="flex items-start justify-between gap-3 rounded border bg-background px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={asset.name}>
          {asset.id}: {asset.name}
        </p>
        {asset.systemLocation && (
          <p className="truncate text-xs text-muted-foreground">{asset.systemLocation}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {criticality && (
          <Badge
            variant={criticality === "MC" ? "default" : "secondary"}
            className="text-[10px]"
          >
            {criticality}
          </Badge>
        )}
        {strategy && (
          <span className="text-[10px] text-muted-foreground">{STRATEGY_LABEL[strategy]}</span>
        )}
      </div>
    </li>
  );
}

function MasterRepoUseCaseRow({ useCase }: { useCase: MasterRepoUseCase }) {
  const crit = useCase.dataAssetCriticality ?? {};
  const mcCount = Object.values(crit).filter((v) => v === "MC").length;
  const vaCount = Object.values(crit).filter((v) => v === "VA").length;
  return (
    <div className="rounded border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{useCase.name}</p>
        <div className="flex shrink-0 gap-1">
          {useCase.economicImpactCategory && (
            <Badge variant="outline" className="text-[10px]">
              {useCase.economicImpactCategory}
            </Badge>
          )}
          {useCase.economicPatternName && (
            <Badge variant="secondary" className="text-[10px]">
              {useCase.economicPatternName}
            </Badge>
          )}
        </div>
      </div>
      {useCase.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{useCase.description}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>MC: {mcCount}</span>
        <span>VA: {vaCount}</span>
        {useCase.totalLoeEstimate && <span>LOE: {useCase.totalLoeEstimate}</span>}
        {useCase.mcAccessDifficulty && <span>MC access: {useCase.mcAccessDifficulty}</span>}
        {useCase.modelType && <span>{useCase.modelType}</span>}
      </div>
    </div>
  );
}
