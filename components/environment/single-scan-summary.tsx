"use client";

import { StatCard } from "@/components/environment/stat-card";
import { ExecutiveSummary } from "@/components/environment/executive-summary";
import type { SingleScanData } from "@/app/environment/types";
import { AlertTriangle, BarChart3, Database, ShieldAlert, Workflow } from "lucide-react";

export interface SingleScanSummaryProps {
  scan: SingleScanData;
  humanSize: (bytes: string | number | null) => string;
  humanNumber: (value: string | number | null) => string;
}

export function SingleScanSummary({ scan, humanSize, humanNumber }: SingleScanSummaryProps) {
  return (
    <div className="space-y-4">
      {/* Executive Summary (reuses the same component as aggregate) */}
      {scan.details.length > 0 && (
        <ExecutiveSummary
          stats={{
            totalTables: scan.tableCount,
            totalScans: 1,
            totalSizeBytes: scan.totalSizeBytes,
            totalRows: scan.totalRows ?? "0",
            domainCount: scan.domainCount,
            piiTablesCount: scan.piiTablesCount,
            avgGovernanceScore: scan.avgGovernanceScore,
            oldestScanAt: scan.createdAt,
            newestScanAt: scan.createdAt,
            coverageByScope: [],
          }}
          details={scan.details}
          insights={scan.insights ?? []}
          humanSize={humanSize}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatCard
          title="Tables"
          value={scan.tableCount}
          icon={<Database className="h-4 w-4" />}
          tooltip="Total tables and views found in this scan, including any discovered by following data lineage beyond your selected scope."
        />
        <StatCard
          title="Size"
          value={humanSize(scan.totalSizeBytes)}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Combined on-disk storage of all tables in this scan. Views typically show 0 bytes as they don't store data directly."
        />
        <StatCard
          title="Total Rows"
          value={humanNumber(scan.totalRows)}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Combined row count across all tables with available statistics. Sourced from Delta table properties or write operation metrics."
        />
        <StatCard
          title="Lineage Discovered"
          value={scan.lineageDiscoveredCount}
          icon={<Workflow className="h-4 w-4" />}
          tooltip="Tables found by walking data lineage — upstream sources and downstream consumers — that were outside your originally selected scope. Shows how your data connects to the wider estate."
        />
        <StatCard
          title="Domains"
          value={scan.domainCount}
          icon={<Database className="h-4 w-4" />}
          tooltip="Business domains identified by AI analysis (e.g. Finance, Customer, Operations). Groups your tables by the business function they serve."
        />
        <StatCard
          title="PII Tables"
          value={scan.piiTablesCount}
          icon={<ShieldAlert className="h-4 w-4" />}
          alert={scan.piiTablesCount > 0}
          tooltip="Tables containing personally identifiable information (names, emails, phone numbers, etc.) that may need compliance controls under GDPR, CCPA, or HIPAA."
        />
        <StatCard
          title="Redundancy Pairs"
          value={scan.redundancyPairsCount}
          icon={<AlertTriangle className="h-4 w-4" />}
          alert={scan.redundancyPairsCount > 0}
          tooltip="Pairs of tables with significant column overlap that may be duplicates, backups, or unnecessary copies. Redundancy wastes storage and risks inconsistent reporting."
        />
        <StatCard
          title="Data Products"
          value={scan.dataProductCount}
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Logical data products identified by AI — cohesive groups of tables that together serve a business function (e.g. 'Customer 360', 'Sales Pipeline'). Formalising these improves reuse and governance."
        />
        <StatCard
          title="Avg Governance"
          value={`${scan.avgGovernanceScore.toFixed(0)}/100`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tooltip="Average governance score across all tables (0 to 100). Factors include documentation coverage, ownership, sensitivity tagging, maintenance frequency, and access controls. Higher is better."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="With Streaming"
          value={scan.tablesWithStreaming}
          tooltip="Tables that receive data via streaming writes (Structured Streaming, Auto Loader, etc.). These tables are continuously updated and may need different maintenance strategies."
        />
        <StatCard
          title="With CDF"
          value={scan.tablesWithCDF}
          tooltip="Tables with Change Data Feed enabled. CDF lets downstream consumers efficiently track row-level inserts, updates, and deletes — essential for incremental ETL pipelines."
        />
        <StatCard
          title="Need OPTIMIZE"
          value={scan.tablesNeedingOptimize}
          alert={scan.tablesNeedingOptimize > 0}
          tooltip="Tables that haven't been OPTIMIZEd in over 30 days. OPTIMIZE compacts small files into larger ones, which dramatically improves query performance and reduces costs."
        />
        <StatCard
          title="Need VACUUM"
          value={scan.tablesNeedingVacuum}
          alert={scan.tablesNeedingVacuum > 0}
          tooltip="Tables that haven't been VACUUMed in over 30 days. VACUUM removes old, unused data files left by previous writes, freeing up storage and reducing cloud costs."
        />
      </div>

      {scan.scanDurationMs && (
        <p className="text-sm text-muted-foreground">
          Scan completed in {(scan.scanDurationMs / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  );
}
