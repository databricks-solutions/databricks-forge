"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { ENVIRONMENT } from "@/lib/help-text";
import type { AggregateStats, InsightRow, TableDetailRow } from "@/app/environment/types";
import { AlertTriangle, BarChart3, FileSpreadsheet, ShieldAlert } from "lucide-react";

export interface ExecutiveSummaryProps {
  stats: AggregateStats;
  details: TableDetailRow[];
  insights: InsightRow[];
  humanSize: (bytes: string | number | null) => string;
}

export function ExecutiveSummary({ stats, details, insights, humanSize }: ExecutiveSummaryProps) {
  // -------------------------------------------------------------------
  // Derive signals
  // -------------------------------------------------------------------
  const tables = details.length;
  const views = details.filter((d) => d.tableType === "VIEW").length;
  const baseTables = tables - views;
  const domains = new Set(details.map((d) => d.dataDomain).filter(Boolean));
  const domainList = Array.from(domains).sort();

  const tiers = { bronze: 0, silver: 0, gold: 0, unclassified: 0 };
  for (const d of details) {
    if (d.dataTier === "bronze") tiers.bronze++;
    else if (d.dataTier === "silver") tiers.silver++;
    else if (d.dataTier === "gold") tiers.gold++;
    else tiers.unclassified++;
  }

  const piiTables = details.filter(
    (d) => d.sensitivityLevel === "confidential" || d.sensitivityLevel === "restricted",
  );
  const noOwner = details.filter((d) => !d.owner);
  const noDescription = details.filter((d) => !d.comment && !d.generatedDescription);
  const govCritical = details.filter(
    (d) => d.governancePriority === "critical" || d.governancePriority === "high",
  );
  const documented = tables - noDescription.length;
  const documentedPct = tables > 0 ? Math.round((documented / tables) * 100) : 0;

  const redundancies = insights.filter((i) => i.insightType === "redundancy");
  const implicitRels = insights.filter((i) => i.insightType === "implicit_relationship");
  const dataProductInsights = insights.filter((i) => i.insightType === "data_product");
  const govGaps = insights.filter((i) => i.insightType === "governance_gap");

  // Parse data product payloads for richer narrative
  const dataProducts: Array<{
    productName: string;
    description: string;
    primaryDomain: string;
    maturityLevel: string;
    tables: string[];
  }> = [];
  for (const dp of dataProductInsights) {
    try {
      dataProducts.push(JSON.parse(dp.payloadJson));
    } catch {
      /* skip malformed */
    }
  }
  const productisedProducts = dataProducts.filter((p) => p.maturityLevel === "productised");
  const curatedProducts = dataProducts.filter((p) => p.maturityLevel === "curated");
  const rawProducts = dataProducts.filter((p) => p.maturityLevel === "raw");

  // -------------------------------------------------------------------
  // Build findings — BUSINESS first, then TECHNICAL
  // -------------------------------------------------------------------
  type Finding = {
    label: string;
    body: string;
    severity: "info" | "warn" | "critical";
    section: "business" | "technical";
  };
  const findings: Finding[] = [];

  // ═══════════════════════════════════════════════════════════════════
  // BUSINESS LAYER
  // ═══════════════════════════════════════════════════════════════════

  // 1. Strategic data landscape
  findings.push({
    label: "Your Data Landscape",
    body: `Your organisation manages ${tables} data assets across ${domainList.length} business domain${domainList.length !== 1 ? "s" : ""}${domainList.length > 0 ? ` — ${domainList.slice(0, 4).join(", ")}${domainList.length > 4 ? ` and ${domainList.length - 4} more` : ""}` : ""}. This represents ${humanSize(stats.totalSizeBytes)} of structured data that can fuel analytics, AI, and decision-making. ${tiers.gold > 0 ? `${tiers.gold} asset${tiers.gold !== 1 ? "s are" : " is"} already at gold (analytics-ready) tier, providing immediate value to business teams.` : "No assets have been classified as analytics-ready (gold tier) yet — this is a quick win to unlock."}`,
    severity: "info",
    section: "business",
  });

  // 2. Analytics readiness / self-service
  const selfServicePct = tables > 0 ? Math.round(((tiers.gold + tiers.silver) / tables) * 100) : 0;
  if (tables > 0) {
    const readinessVerdict =
      selfServicePct >= 60
        ? "Your estate is well-positioned for self-service analytics. Business teams can query and build dashboards on most data without engineering support."
        : selfServicePct >= 30
          ? "A moderate portion of data is ready for business consumption, but significant effort is needed to curate more datasets from bronze to silver/gold tiers to support self-service at scale."
          : "Most of your data is in raw (bronze) form. Business teams cannot easily consume it without significant transformation. Prioritising a curation pipeline would directly reduce time-to-insight for stakeholders.";
    findings.push({
      label: "Self-Service Readiness",
      body: `${selfServicePct}% of your data assets are at silver or gold tier, meaning they are curated and ready for business consumption. ${readinessVerdict}`,
      severity: selfServicePct >= 60 ? "info" : selfServicePct >= 30 ? "warn" : "critical",
      section: "business",
    });
  }

  // 3. Data products = business capabilities
  if (dataProducts.length > 0) {
    const productNames = dataProducts
      .slice(0, 3)
      .map((p) => `"${p.productName}"`)
      .join(", ");
    findings.push({
      label: "Business Data Products",
      body: `${dataProducts.length} data product${dataProducts.length !== 1 ? "s have" : " has"} been identified — reusable data assets that directly support business functions (${productNames}${dataProducts.length > 3 ? ` and ${dataProducts.length - 3} more` : ""}). ${productisedProducts.length > 0 ? `${productisedProducts.length} ${productisedProducts.length !== 1 ? "are" : "is"} already productised with defined consumers.` : ""} ${curatedProducts.length > 0 ? `${curatedProducts.length} ${curatedProducts.length !== 1 ? "are" : "is"} curated and near-ready for wider adoption.` : ""} ${rawProducts.length > 0 ? `${rawProducts.length} ${rawProducts.length !== 1 ? "are" : "is"} in early stages and would benefit from investment to become self-service ready.` : ""} Formalising these as named products with SLAs and owners accelerates time-to-value for downstream teams and AI initiatives.`,
      severity: "info",
      section: "business",
    });
  } else if (domainList.length > 0) {
    findings.push({
      label: "Data Product Opportunity",
      body: `No formal data products have been identified yet, but your data spans ${domainList.length} business domain${domainList.length !== 1 ? "s" : ""}. Each domain likely contains candidate data products — curated datasets that multiple teams could reuse. Identifying and productising these would reduce duplicated effort, improve consistency, and accelerate analytics delivery.`,
      severity: "warn",
      section: "business",
    });
  }

  // 4. Compliance & regulatory exposure
  if (piiTables.length > 0) {
    const piiPct = Math.round((piiTables.length / tables) * 100);
    const piiDomains = new Set(piiTables.map((d) => d.dataDomain).filter(Boolean));
    findings.push({
      label: "Regulatory & Privacy Exposure",
      body: `${piiPct}% of your data estate (${piiTables.length} asset${piiTables.length !== 1 ? "s" : ""}) contains personally identifiable or restricted information, touching ${piiDomains.size} business domain${piiDomains.size !== 1 ? "s" : ""}. This creates obligations under regulations like GDPR, CCPA, or HIPAA. Without proper access controls and classification, the business faces regulatory fines, brand damage, and potential loss of customer trust. Proactive governance here directly protects revenue and reputation.`,
      severity: "critical",
      section: "business",
    });
  } else {
    findings.push({
      label: "Privacy & Compliance",
      body: "No sensitive or PII data was detected in the scanned estate. This simplifies compliance obligations, but you should verify this covers all business-critical datasets by expanding scan scope if needed.",
      severity: "info",
      section: "business",
    });
  }

  // 5. Discoverability & time-to-insight
  findings.push({
    label: "Data Discoverability",
    body: `${documentedPct}% of your data assets have descriptions (either human-authored or auto-generated). ${
      documentedPct >= 70
        ? "Analysts and data scientists can find and understand most datasets quickly, reducing onboarding time and enabling faster project delivery."
        : documentedPct >= 40
          ? "Many datasets lack descriptions, which forces analysts to spend time asking data engineers what tables mean — a hidden cost that slows every analytics project."
          : "The majority of datasets have no documentation. This means every new analytics initiative starts with a discovery phase that could take days or weeks. Improving documentation coverage would directly reduce the time from business question to actionable insight."
    }${noOwner.length > 0 ? ` Additionally, ${noOwner.length} asset${noOwner.length !== 1 ? "s have" : " has"} no assigned owner — when something breaks, there is no clear point of accountability.` : ""}`,
    severity: documentedPct >= 70 ? "info" : "warn",
    section: "business",
  });

  // 6. Cost & efficiency
  if (redundancies.length > 0) {
    findings.push({
      label: "Wasted Spend & Inconsistency Risk",
      body: `${redundancies.length} pair${redundancies.length !== 1 ? "s" : ""} of datasets appear to contain overlapping or duplicate data. Beyond the storage cost of maintaining multiple copies, this creates a real business risk: different teams may make decisions based on different versions of the same data, leading to conflicting reports, eroded stakeholder trust, and costly reconciliation efforts.`,
      severity: "warn",
      section: "business",
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TECHNICAL LAYER
  // ═══════════════════════════════════════════════════════════════════

  // Estate composition (compact)
  findings.push({
    label: "Estate Composition",
    body: `${baseTables} tables and ${views} views totalling ${humanSize(stats.totalSizeBytes)}. Medallion tiers: ${tiers.gold} gold, ${tiers.silver} silver, ${tiers.bronze} bronze${tiers.unclassified > 0 ? `, ${tiers.unclassified} unclassified` : ""}.`,
    severity: "info",
    section: "technical",
  });

  // Implicit relationships
  if (implicitRels.length > 0) {
    findings.push({
      label: "Undocumented Relationships",
      body: `${implicitRels.length} implicit relationship${implicitRels.length !== 1 ? "s were" : " was"} inferred from column naming patterns. Formalising these as foreign keys improves query performance, lineage accuracy, and analyst understanding of how data connects.`,
      severity: "info",
      section: "technical",
    });
  }

  // Governance score
  if (stats.avgGovernanceScore > 0) {
    const score = stats.avgGovernanceScore;
    const verdict = score >= 70 ? "healthy" : score >= 40 ? "needs attention" : "at risk";
    findings.push({
      label: "Governance Score",
      body: `Average governance score: ${score.toFixed(0)}/100 (${verdict}). ${govCritical.length > 0 ? `${govCritical.length} asset${govCritical.length !== 1 ? "s" : ""} flagged as critical or high priority.` : ""} Factors: documentation, ownership, sensitivity labelling, access controls, maintenance, and tagging.`,
      severity: score >= 70 ? "info" : score >= 40 ? "warn" : "critical",
      section: "technical",
    });
  }

  // Views
  if (views > 0) {
    findings.push({
      label: "Views in the Estate",
      body: `${views} view${views !== 1 ? "s" : ""} found. These are included in lineage tracking and domain classification. Views acting as curated access layers should be documented and governed as first-class assets.`,
      severity: "info",
      section: "technical",
    });
  }

  if (findings.length === 0) return null;

  const businessFindings = findings.filter((f) => f.section === "business");
  const technicalFindings = findings.filter((f) => f.section === "technical");

  const severityIcon = (sev: string) => {
    if (sev === "critical") return <ShieldAlert className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
    if (sev === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
    return <BarChart3 className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
  };

  const critCount = govGaps.filter((g) => g.severity === "critical").length;
  const highCount = govGaps.filter((g) => g.severity === "high").length;
  const actionCount = findings.filter(
    (f) => f.severity === "critical" || f.severity === "warn",
  ).length;

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          Executive Summary
          <InfoTip tip={ENVIRONMENT.executiveSummary} />
        </CardTitle>
        <CardDescription>
          {actionCount > 0
            ? `${actionCount} finding${actionCount !== 1 ? "s" : ""} require${actionCount === 1 ? "s" : ""} attention. ${critCount + highCount > 0 ? `${critCount + highCount} governance gap${critCount + highCount !== 1 ? "s" : ""} at critical/high priority.` : ""}`
            : "Your data estate is in good shape. No critical findings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Business perspective */}
          {businessFindings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Business Perspective
              </h4>
              <div className="space-y-4">
                {businessFindings.map((f, idx) => (
                  <div key={`biz-${idx}`} className="flex gap-3">
                    {severityIcon(f.severity)}
                    <div>
                      <p className="text-sm font-semibold">{f.label}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technical findings */}
          {technicalFindings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Technical Detail
              </h4>
              <div className="space-y-3">
                {technicalFindings.map((f, idx) => (
                  <div key={`tech-${idx}`} className="flex gap-3">
                    {severityIcon(f.severity)}
                    <div>
                      <p className="text-sm font-semibold">{f.label}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
