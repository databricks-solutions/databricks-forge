"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { TableEnrichmentData, SourceData } from "./ask-forge-chat";
import {
  Database,
  Heart,
  Clock,
  User,
  GitBranch,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  CheckCircle2,
  FolderTree,
  ShieldAlert,
  Columns3,
  ExternalLink,
  MessageCircleQuestion,
  Loader2,
  FileSearch,
  FileText,
  Sparkles,
  Network,
  Table2,
  Lightbulb,
  BarChart3,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface TableDetailData {
  detail: {
    tableFqn: string;
    catalog: string;
    schema: string;
    tableName: string;
    tableType?: string;
    comment?: string;
    generatedDescription?: string;
    format?: string;
    owner?: string;
    sizeInBytes?: string;
    numRows?: string;
    numFiles?: number;
    lastModified?: string;
    dataDomain?: string;
    dataSubdomain?: string;
    dataTier?: string;
    sensitivityLevel?: string;
    governanceScore?: number;
    autoOptimize?: boolean;
    cdfEnabled?: boolean;
    createdBy?: string;
  };
  columns: Array<{
    name: string;
    type_name?: string;
    data_type?: string;
    comment?: string;
    nullable?: boolean;
    is_pii?: boolean;
  }>;
  history: {
    totalWriteOps: number;
    totalStreamingOps: number;
    totalOptimizeOps: number;
    totalVacuumOps: number;
    totalMergeOps: number;
    lastWriteTimestamp?: string;
    lastWriteOperation?: string;
    lastOptimizeTimestamp?: string;
    lastVacuumTimestamp?: string;
    hasStreamingWrites: boolean;
    historyDays: number;
    healthScore?: number;
    issuesJson?: string;
    recommendationsJson?: string;
  } | null;
  lineage: {
    upstream: Array<{ sourceTableFqn: string; targetTableFqn: string; eventCount?: number }>;
    downstream: Array<{ sourceTableFqn: string; targetTableFqn: string; eventCount?: number }>;
  };
  insights: Array<{ insightType: string; payloadJson: string; severity: string }>;
  useCases: Array<{
    id: string;
    name: string;
    domain: string;
    type: string;
    overallScore: number | null;
    runId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AskForgeContextPanelProps {
  enrichments: TableEnrichmentData[];
  tableDetails: Map<string, TableDetailData>;
  referencedTables: string[];
  chatMentionedTables?: string[];
  sources: SourceData[];
  loadingTables: boolean;
  onAskAboutTable?: (fqn: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AskForgeContextPanel({
  enrichments,
  tableDetails,
  referencedTables,
  chatMentionedTables = [],
  sources,
  loadingTables,
  onAskAboutTable,
}: AskForgeContextPanelProps) {
  const [expandedTables, setExpandedTables] = React.useState<Set<string>>(new Set());
  const [showErdModal, setShowErdModal] = React.useState(false);
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    tables: true,
    lineage: false,
    sources: false,
  });

  const hasContent = referencedTables.length > 0 || sources.length > 0 || enrichments.length > 0;

  const toggleTable = (fqn: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(fqn)) next.delete(fqn);
      else next.add(fqn);
      return next;
    });
  };

  const tableFqns =
    referencedTables.length > 0 ? referencedTables : enrichments.map((e) => e.tableFqn);

  const classifiedTables = React.useMemo(() => {
    const chatFqns = new Set(chatMentionedTables.map((t) => t.toLowerCase()));
    const enrichedFqns = new Set(enrichments.map((e) => e.tableFqn.toLowerCase()));

    type RefType = "direct" | "related";
    const classified: Array<{ fqn: string; type: RefType }> = tableFqns.map((fqn) => {
      const lower = fqn.toLowerCase();
      if (chatFqns.size > 0) {
        return { fqn, type: chatFqns.has(lower) ? "direct" : "related" };
      }
      return { fqn, type: enrichedFqns.has(lower) ? "direct" : "related" };
    });

    const order: Record<RefType, number> = { direct: 0, related: 1 };
    return classified.sort((a, b) => order[a.type] - order[b.type]);
  }, [tableFqns, chatMentionedTables, enrichments]);

  const directTables = classifiedTables.filter((t) => t.type === "direct");
  const relatedTables = classifiedTables.filter((t) => t.type === "related");
  const [showRelated, setShowRelated] = React.useState(false);

  if (!hasContent && !loadingTables) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="flex items-center gap-3 text-muted-foreground/25">
          <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-muted-foreground/20">
            <Database className="size-5" />
          </div>
          <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-muted-foreground/20">
            <GitBranch className="size-5" />
          </div>
          <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-muted-foreground/20">
            <FileSearch className="size-5" />
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground/60">Context appears here</p>
          <p className="mx-auto mt-1.5 max-w-[220px] text-xs text-muted-foreground/40">
            Ask a question to see referenced tables, lineage, and sources
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <div className="min-w-0 space-y-5 p-4">
        {/* Referenced Tables */}
        {(tableFqns.length > 0 || loadingTables) && (
          <CollapsibleSection
            icon={<Database className="size-4 text-primary" />}
            title="Referenced Tables"
            count={tableFqns.length}
            open={openSections.tables}
            onToggle={() => setOpenSections((s) => ({ ...s, tables: !s.tables }))}
            loading={loadingTables}
          >
            {(directTables.length > 0 || relatedTables.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                {directTables.length > 0 && (
                  <Badge variant="default" className="bg-primary/90 text-[10px]">
                    {directTables.length} direct
                  </Badge>
                )}
                {relatedTables.length > 0 && (
                  <Badge
                    variant="outline"
                    className="border-dashed text-muted-foreground text-[10px]"
                  >
                    {relatedTables.length} related
                  </Badge>
                )}
              </div>
            )}
            <div className="mt-2 space-y-3">
              {loadingTables && tableFqns.length === 0 && (
                <>
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                </>
              )}

              {/* Direct References */}
              {directTables.map(({ fqn, type: refType }) => {
                const detail = tableDetails.get(fqn);
                const enrichment = enrichments.find((e) => e.tableFqn === fqn);
                const isExpanded = expandedTables.has(fqn);
                return (
                  <RichTableCard
                    key={fqn}
                    fqn={fqn}
                    detail={detail}
                    enrichment={enrichment}
                    isExpanded={isExpanded}
                    onToggle={() => toggleTable(fqn)}
                    onAskAbout={() => onAskAboutTable?.(fqn)}
                    referenceType={refType}
                  />
                );
              })}

              {/* Other Related Tables */}
              {relatedTables.length > 0 && directTables.length > 0 && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowRelated((p) => !p)}
                >
                  <div className="h-px flex-1 bg-border" />
                  <span>
                    {showRelated ? "Hide" : "Show"} {relatedTables.length} related table
                    {relatedTables.length !== 1 ? "s" : ""}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </button>
              )}
              {(showRelated || directTables.length === 0) &&
                relatedTables.map(({ fqn, type: refType }) => {
                  const detail = tableDetails.get(fqn);
                  const enrichment = enrichments.find((e) => e.tableFqn === fqn);
                  const isExpanded = expandedTables.has(fqn);
                  return (
                    <RichTableCard
                      key={fqn}
                      fqn={fqn}
                      detail={detail}
                      enrichment={enrichment}
                      isExpanded={isExpanded}
                      onToggle={() => toggleTable(fqn)}
                      onAskAbout={() => onAskAboutTable?.(fqn)}
                      referenceType={refType}
                    />
                  );
                })}
            </div>

            {tableFqns.length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full gap-1.5 text-xs"
                onClick={() => setShowErdModal(true)}
              >
                <Network className="size-3.5" />
                View ERD ({tableFqns.length} tables)
              </Button>
            )}
          </CollapsibleSection>
        )}

        {/* Lineage Overview */}
        {tableFqns.length > 0 &&
          (() => {
            const lineageCount = tableFqns.filter((fqn) => {
              const d = tableDetails.get(fqn);
              const e = enrichments.find((en) => en.tableFqn === fqn);
              if (!d && !e) return false;
              const up = d ? d.lineage.upstream.length : (e?.upstreamTables?.length ?? 0);
              const down = d ? d.lineage.downstream.length : (e?.downstreamTables?.length ?? 0);
              return up > 0 || down > 0;
            }).length;

            if (lineageCount === 0) return null;

            return (
              <CollapsibleSection
                icon={<GitBranch className="size-4 text-primary" />}
                title="Lineage"
                count={lineageCount}
                open={openSections.lineage}
                onToggle={() => setOpenSections((s) => ({ ...s, lineage: !s.lineage }))}
              >
                <div className="mt-2 space-y-1.5">
                  {tableFqns.map((fqn) => {
                    const detail = tableDetails.get(fqn);
                    const enrichment = enrichments.find((e) => e.tableFqn === fqn);
                    if (!detail && !enrichment) return null;

                    const upstream = detail
                      ? detail.lineage.upstream.map((l) => l.sourceTableFqn)
                      : (enrichment?.upstreamTables ?? []);
                    const downstream = detail
                      ? detail.lineage.downstream.map((l) => l.targetTableFqn)
                      : (enrichment?.downstreamTables ?? []);

                    if (upstream.length === 0 && downstream.length === 0) return null;

                    return (
                      <LineageSummary
                        key={fqn}
                        fqn={fqn}
                        upstream={upstream}
                        downstream={downstream}
                      />
                    );
                  })}
                </div>
              </CollapsibleSection>
            );
          })()}

        {/* Sources */}
        {sources.length > 0 && (
          <CollapsibleSection
            icon={<FileSearch className="size-4 text-primary" />}
            title="Sources"
            count={sources.length}
            open={openSections.sources}
            onToggle={() => setOpenSections((s) => ({ ...s, sources: !s.sources }))}
          >
            <div className="mt-2 space-y-1.5">
              {sources.map((src) => (
                <SourceRow key={`${src.kind}-${src.sourceId}-${src.index}`} source={src} />
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>

      {showErdModal && (
        <ErdModalLazy tableFqns={tableFqns} onClose={() => setShowErdModal(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich Table Card
// ---------------------------------------------------------------------------

function RichTableCard({
  fqn,
  detail,
  enrichment,
  isExpanded,
  onToggle,
  onAskAbout,
  referenceType,
}: {
  fqn: string;
  detail?: TableDetailData;
  enrichment?: TableEnrichmentData;
  isExpanded: boolean;
  onToggle: () => void;
  onAskAbout: () => void;
  referenceType?: "direct" | "related" | "lineage" | "implied";
}) {
  const parts = fqn.split(".");
  const shortName = parts.length >= 3 ? parts[2] : fqn;
  const schemaPath = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : "";

  const d = detail?.detail;
  const h = detail?.history;

  const healthScore = h?.healthScore ?? enrichment?.healthScore ?? null;
  const owner = d?.owner ?? enrichment?.owner ?? null;
  const numRows = d?.numRows ?? enrichment?.numRows ?? null;
  const sizeInBytes = d?.sizeInBytes ?? enrichment?.sizeInBytes ?? null;
  const lastModified = d?.lastModified ?? enrichment?.lastModified ?? null;
  const domain = d?.dataDomain ?? enrichment?.dataDomain ?? null;
  const tier = d?.dataTier ?? enrichment?.dataTier ?? null;
  const sensitivity = d?.sensitivityLevel ?? null;
  const governanceScore = d?.governanceScore ?? null;
  const description = d?.generatedDescription ?? d?.comment ?? null;

  const aiSummary =
    !description && detail?.insights?.[0] ? parseInsightSummary(detail.insights[0]) : null;

  const piiColumns = detail?.columns.filter((c) => c.is_pii) ?? [];
  const columnCount = detail?.columns.length ?? 0;

  const issues = enrichment?.issues ?? parseJsonArray(h?.issuesJson);
  const useCases = detail?.useCases ?? [];

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card text-xs">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full min-w-0 items-start justify-between gap-2 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/environment/table/${encodeURIComponent(fqn)}`}
              className="font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {shortName}
            </Link>
            <ExternalLink className="size-3 text-muted-foreground" />
            {(referenceType === "related" || referenceType === "implied") && (
              <Badge
                variant="outline"
                className="border-dashed text-muted-foreground text-[9px] px-1 py-0"
              >
                related
              </Badge>
            )}
            {referenceType === "lineage" && (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-600 text-[9px] px-1 py-0"
              >
                lineage
              </Badge>
            )}
          </div>
          {schemaPath && <p className="truncate text-muted-foreground">{schemaPath}</p>}
          {!isExpanded && description && (
            <p className="mt-1 line-clamp-1 text-muted-foreground">{description}</p>
          )}
          {!isExpanded && !description && aiSummary && (
            <p className="mt-1 flex items-center gap-1 line-clamp-1 text-muted-foreground">
              <Sparkles className="size-3 shrink-0 text-purple-500" />
              {aiSummary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sensitivity && sensitivity !== "none" && (
            <Badge variant="destructive" className="text-[9px]">
              <ShieldAlert className="mr-0.5 size-2.5" />
              {sensitivity}
            </Badge>
          )}
          {healthScore !== null && <HealthBadge score={healthScore} />}
        </div>
      </button>

      {/* Summary row (always visible) */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-muted-foreground">
        {domain && (
          <span className="flex items-center gap-1">
            <FolderTree className="size-3" />
            {domain}
            {tier ? ` (${tier})` : ""}
          </span>
        )}
        {numRows && (
          <span className="flex items-center gap-1">
            <Database className="size-3" />
            {formatNumber(Number(numRows))} rows
          </span>
        )}
        {lastModified && (
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatRelativeDate(lastModified)}
          </span>
        )}
        {piiColumns.length > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <ShieldAlert className="size-3" />
            {piiColumns.length} PII col{piiColumns.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="space-y-3 border-t px-3 py-3">
          {description && <p className="text-muted-foreground">{description}</p>}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {owner && <Detail icon={User} label="Owner" value={owner} />}
            {sizeInBytes && (
              <Detail icon={Database} label="Size" value={formatBytes(Number(sizeInBytes))} />
            )}
            {governanceScore !== null && (
              <Detail
                icon={ShieldAlert}
                label="Governance"
                value={`${governanceScore.toFixed(0)}/100`}
              />
            )}
            {h?.lastWriteTimestamp && (
              <Detail
                icon={Clock}
                label="Last write"
                value={`${formatRelativeDate(h.lastWriteTimestamp)}${h.lastWriteOperation ? ` (${h.lastWriteOperation})` : ""}`}
              />
            )}
            {h && (
              <Detail
                icon={Database}
                label="Writes"
                value={`${h.totalWriteOps} writes, ${h.totalMergeOps} merges`}
              />
            )}
            {h?.hasStreamingWrites && <Detail icon={Sparkles} label="Streaming" value="Active" />}
          </div>

          {/* Columns preview */}
          {columnCount > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <Columns3 className="size-3" />
                Columns ({columnCount})
              </p>
              <div className="flex flex-wrap gap-1">
                {detail!.columns.slice(0, 12).map((col) => (
                  <Badge
                    key={col.name}
                    variant={col.is_pii ? "destructive" : "secondary"}
                    className="text-[9px]"
                  >
                    {col.name}
                    {col.is_pii && " (PII)"}
                  </Badge>
                ))}
                {columnCount > 12 && (
                  <Badge variant="outline" className="text-[9px]">
                    +{columnCount - 12} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Issues</p>
              {issues.slice(0, 3).map((issue, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span className="text-[11px]">{issue}</span>
                </div>
              ))}
            </div>
          )}

          {/* Related use cases */}
          {useCases.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <Sparkles className="size-3" />
                Related Use Cases ({useCases.length})
              </p>
              <div className="space-y-1">
                {useCases.slice(0, 4).map((uc) => (
                  <div
                    key={uc.id}
                    className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1"
                  >
                    <Link
                      href={`/runs/${uc.runId}?usecase=${uc.id}`}
                      className="flex-1 truncate text-[11px] font-medium text-primary hover:underline"
                    >
                      {uc.name}
                    </Link>
                    {uc.overallScore !== null && (
                      <Badge variant="outline" className="ml-1 text-[9px]">
                        {uc.overallScore.toFixed(0)}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Insights */}
          {detail?.insights && detail.insights.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">Insights</p>
              {detail.insights.slice(0, 3).map((insight, i) => (
                <InsightRow key={i} insight={insight} />
              ))}
            </div>
          )}

          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={onAskAbout}>
            <MessageCircleQuestion className="size-3.5" />
            Ask Forge about this table
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CollapsibleSection({
  icon,
  title,
  count,
  open,
  onToggle,
  children,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 text-sm font-semibold transition-colors hover:text-primary">
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          {icon}
          {title}
          {count > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {count}
            </Badge>
          )}
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function InsightRow({
  insight,
}: {
  insight: { insightType: string; payloadJson: string; severity: string };
}) {
  let summary = insight.insightType;
  try {
    const payload = JSON.parse(insight.payloadJson);
    if (payload.summary) summary = payload.summary;
    else if (payload.description) summary = payload.description;
  } catch {
    // use raw insightType
  }

  const severityColor =
    insight.severity === "critical"
      ? "text-red-600 dark:text-red-400"
      : insight.severity === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-blue-600 dark:text-blue-400";

  return (
    <div className={`flex items-start gap-1.5 text-[11px] ${severityColor}`}>
      <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
      <span>{summary}</span>
    </div>
  );
}

function LineageSummary({
  fqn,
  upstream,
  downstream,
}: {
  fqn: string;
  upstream: string[];
  downstream: string[];
}) {
  const parts = fqn.split(".");
  const shortName = parts.length >= 3 ? parts[2] : fqn;

  return (
    <div className="min-w-0 overflow-hidden rounded border bg-muted/30 p-2 text-[11px]">
      <p className="truncate font-medium">{shortName}</p>
      {upstream.length > 0 && (
        <div className="mt-1 flex items-start gap-1 text-muted-foreground">
          <ArrowDownRight className="mt-0.5 size-3 shrink-0 text-blue-500" />
          <span className="min-w-0 truncate">From: {upstream.map(shortFqn).join(", ")}</span>
        </div>
      )}
      {downstream.length > 0 && (
        <div className="mt-0.5 flex items-start gap-1 text-muted-foreground">
          <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-green-500" />
          <span className="min-w-0 truncate">To: {downstream.map(shortFqn).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

const SOURCE_KIND_ICONS: Record<string, React.ReactNode> = {
  table_detail: <Table2 className="size-3 text-blue-500" />,
  column_profile: <Database className="size-3 text-indigo-500" />,
  use_case: <Lightbulb className="size-3 text-amber-500" />,
  business_context: <BarChart3 className="size-3 text-green-500" />,
  genie_recommendation: <Sparkles className="size-3 text-purple-500" />,
  genie_question: <MessageSquare className="size-3 text-purple-400" />,
  environment_insight: <ShieldAlert className="size-3 text-orange-500" />,
  table_health: <Heart className="size-3 text-red-500" />,
  data_product: <Database className="size-3 text-teal-500" />,
  outcome_map: <FileText className="size-3 text-cyan-500" />,
  lineage_context: <GitBranch className="size-3 text-gray-500" />,
  document_chunk: <FileText className="size-3 text-gray-400" />,
  fabric_dataset: <ExternalLink className="size-3 text-yellow-600" />,
  fabric_measure: <ExternalLink className="size-3 text-yellow-600" />,
  fabric_report: <ExternalLink className="size-3 text-yellow-600" />,
  fabric_artifact: <ExternalLink className="size-3 text-yellow-600" />,
};

function isFabricKind(kind: string): boolean {
  return kind.startsWith("fabric_");
}

function getSourceHref(kind: string, sourceId: string): string | null {
  switch (kind) {
    case "table_detail":
    case "column_profile":
    case "table_health":
      return `/environment/tables/${encodeURIComponent(sourceId)}`;
    case "use_case":
      return "/use-cases";
    case "genie_recommendation":
    case "genie_question":
      return "/genie";
    case "environment_insight":
    case "data_product":
      return "/environment";
    case "lineage_context":
      return `/environment/tables/${encodeURIComponent(sourceId)}`;
    default:
      return null;
  }
}

function SourceRow({ source }: { source: SourceData }) {
  const [expanded, setExpanded] = React.useState(false);
  const kindLabel = SOURCE_KIND_LABELS[source.kind] ?? source.kind;
  const icon = SOURCE_KIND_ICONS[source.kind] ?? <FileSearch className="size-3" />;
  const scorePercent = (source.score * 100).toFixed(0);
  const metadata = source.metadata;
  const offPlatform = isFabricKind(source.kind);
  const href = getSourceHref(source.kind, source.sourceId);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={`flex w-full min-w-0 flex-col rounded border px-2.5 py-2 text-left text-[11px] transition-colors hover:bg-muted/60 ${offPlatform ? "bg-yellow-50/50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800" : "bg-muted/30"}`}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5">
        {icon}
        <Badge
          variant="outline"
          className={`shrink-0 text-[9px] ${offPlatform ? "border-yellow-400 text-yellow-700 dark:text-yellow-400" : ""}`}
        >
          {kindLabel}
        </Badge>
        {offPlatform && (
          <span
            className="shrink-0 text-[9px] text-yellow-600 dark:text-yellow-400"
            title="Off-platform resource (Power BI)"
          >
            ⚡ PBI
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{source.sourceId}</span>
        {href && (
          <Link
            href={href}
            className="shrink-0 text-primary hover:text-primary/80"
            title="Open"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3" />
          </Link>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{scorePercent}%</span>
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </div>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          <p className="break-words text-muted-foreground">{source.label}</p>
          {metadata && Object.keys(metadata).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(metadata)
                .slice(0, 8)
                .map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="text-[9px]">
                    {k}: {String(v).slice(0, 50)}
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

function HealthBadge({ score }: { score: number }) {
  let color = "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
  if (score < 50) color = "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  else if (score < 75) color = "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";

  return (
    <div className="flex items-center gap-1">
      <Heart className="size-3" />
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${color}`}>{score}</span>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-1.5 text-muted-foreground">
      <Icon className="mt-0.5 size-3 shrink-0" />
      <div className="min-w-0">
        <span className="text-[10px]">{label}</span>
        <p className="truncate font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ERD Modal (lazy loaded)
// ---------------------------------------------------------------------------

function ErdModalLazy({ tableFqns, onClose }: { tableFqns: string[]; onClose: () => void }) {
  const [ErdModal, setErdModal] = React.useState<React.ComponentType<{
    tableFqns: string[];
    onClose: () => void;
  }> | null>(null);

  React.useEffect(() => {
    import("./erd-modal").then((m) => setErdModal(() => m.ErdModal));
  }, []);

  if (!ErdModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="size-8 animate-spin text-white" />
      </div>
    );
  }

  return <ErdModal tableFqns={tableFqns} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_KIND_LABELS: Record<string, string> = {
  table_detail: "Table",
  column_profile: "Column",
  table_health: "Health",
  lineage_context: "Lineage",
  environment_insight: "Insight",
  data_product: "Product",
  use_case: "Use Case",
  business_context: "Business",
  genie_recommendation: "Genie",
  genie_question: "Question",
  outcome_map: "Outcome",
  document_chunk: "Document",
  fabric_dataset: "PBI Dataset",
  fabric_measure: "PBI Measure",
  fabric_report: "PBI Report",
  fabric_artifact: "Fabric",
};

function shortFqn(fqn: string): string {
  const parts = fqn.split(".");
  return parts.length >= 3 ? parts[2] : fqn;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseInsightSummary(insight: { insightType: string; payloadJson: string }): string {
  try {
    const payload = JSON.parse(insight.payloadJson);
    return payload.summary ?? payload.description ?? insight.insightType;
  } catch {
    return insight.insightType;
  }
}
