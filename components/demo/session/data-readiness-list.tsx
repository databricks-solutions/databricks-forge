"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Zap, ChevronRight } from "lucide-react";
import type { DataAssetDetail, DataStrategyMap } from "@/lib/demo/research-engine/types";

interface DataReadinessListProps {
  dataStrategy: DataStrategyMap;
}

function relevanceColor(score: number): string {
  if (score >= 8) return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (score >= 5) return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20";
}

function AssetRow({ asset, useCases }: { asset: DataAssetDetail; useCases: DataStrategyMap["prioritisedUseCases"] }) {
  const linkedUcs = useCases.filter((uc) => uc.dataAssetIds?.includes(asset.id));

  return (
    <div className="flex items-start gap-3 py-3 px-3.5">
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
        {asset.id}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{asset.rationale}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${relevanceColor(asset.relevance)}`}>
            Relevance: {asset.relevance}/10
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {asset.criticality === "MC" ? "Mission-Critical" : "Value-Add"}
          </Badge>
          {asset.quickWin && (
            <Badge className="text-[10px] gap-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
              <Zap className="h-3 w-3" />
              Quick Win
            </Badge>
          )}
        </div>
        {linkedUcs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {linkedUcs.map((uc, i) => (
              <span key={i} className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3" />
                {uc.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DataReadinessList({ dataStrategy }: DataReadinessListProps) {
  const assets = dataStrategy.assetDetails ?? [];
  const useCases = dataStrategy.prioritisedUseCases ?? [];

  if (assets.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            Data Readiness
          </div>
          {dataStrategy.dataMaturityAssessment && (
            <Badge variant="secondary" className="text-[10px] capitalize">
              {dataStrategy.dataMaturityAssessment.replace(/-/g, " ")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {assets.map((asset, i) => (
            <AssetRow key={i} asset={asset} useCases={useCases} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
