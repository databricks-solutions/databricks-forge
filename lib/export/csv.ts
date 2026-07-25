/**
 * CSV export generator for use cases.
 */

import type { PipelineRun, UseCase } from "@/lib/domain/types";

const CSV_HEADERS = [
  "No",
  "Name",
  "Type",
  "Domain",
  "Subdomain",
  "Analytics Technique",
  "Statement",
  "Solution",
  "Business Value",
  "Beneficiary",
  "Sponsor",
  "Priority Score",
  "Feasibility Score",
  "Impact Score",
  "Overall Score",
  "Priority Rationale",
  "Feasibility Rationale",
  "Impact Rationale",
  "Tables Involved",
  "Enrichment",
  "SQL Status",
  "Feedback",
];

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateCsv(_run: PipelineRun, useCases: UseCase[]): Buffer {
  const rows = [CSV_HEADERS.join(",")];

  for (const uc of useCases) {
    rows.push(
      [
        String(uc.useCaseNo),
        escapeCsvField(uc.name),
        uc.type,
        escapeCsvField(uc.domain),
        escapeCsvField(uc.subdomain),
        escapeCsvField(uc.analyticsTechnique),
        escapeCsvField(uc.statement),
        escapeCsvField(uc.solution),
        escapeCsvField(uc.businessValue),
        escapeCsvField(uc.beneficiary),
        escapeCsvField(uc.sponsor),
        uc.priorityScore.toFixed(3),
        uc.feasibilityScore.toFixed(3),
        uc.impactScore.toFixed(3),
        uc.overallScore.toFixed(3),
        escapeCsvField(uc.scoreRationale?.priority.rationale ?? ""),
        escapeCsvField(uc.scoreRationale?.feasibility.rationale ?? ""),
        escapeCsvField(uc.scoreRationale?.impact.rationale ?? ""),
        escapeCsvField(uc.tablesInvolved.join("; ")),
        escapeCsvField((uc.enrichmentTags ?? []).join(", ")),
        uc.sqlStatus ?? "",
        uc.feedback ?? "",
      ].join(","),
    );
  }

  return Buffer.from(rows.join("\n"), "utf-8");
}
