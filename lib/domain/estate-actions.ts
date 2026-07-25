/**
 * Findings-to-action registry — maps each estate finding kind to the Forge
 * engine that remediates it ("engines as next-best-actions"). The synthesis
 * engine attaches a concrete `EstateAction` to each finding; this registry is
 * the single source of truth for the default routing + labels so the UI and
 * the engine agree, and so the action set can be rendered as a standalone
 * "what should we do next" backlog.
 */

import type {
  EstateActionEngine,
  EstateFindingKind,
  EstateAction,
} from "@/lib/domain/estate-synthesis-types";

export interface ActionDefinition {
  engine: EstateActionEngine;
  label: string;
  /** Build the href from a scan id. */
  href: (scanId: string) => string;
  /** One-line description of what running this engine does. */
  description: string;
}

export const ESTATE_ACTION_REGISTRY: Record<EstateFindingKind, ActionDefinition> = {
  opportunity: {
    engine: "opportunities",
    label: "Generate opportunities",
    href: (scanId) => `/configure?fromScan=${encodeURIComponent(scanId)}`,
    description:
      "Run discovery grounded in this estate to produce a scored, SQL-ready use-case backlog.",
  },
  documentation_gap: {
    engine: "comments",
    label: "Document with AI Comments",
    href: (scanId) => `/environment/comments?scan=${encodeURIComponent(scanId)}`,
    description:
      "Generate industry-aware table + column descriptions to make the estate Genie-ready.",
  },
  query_ready_domain: {
    engine: "genie",
    label: "Stand up a Genie space",
    href: () => `/genie/create/schema`,
    description: "Create a Genie space over a curated, query-ready domain for self-serve Q&A.",
  },
  coverage_gap: {
    engine: "data-gap",
    label: "Close the data gaps",
    href: (scanId) => `/environment?scan=${encodeURIComponent(scanId)}&tab=data-gap`,
    description:
      "Review missing reference data assets and the recommended ingestion path for each.",
  },
  well_architected_gap: {
    engine: "waf",
    label: "Run Well-Architected Assessment",
    href: () => `/assessment`,
    description: "Score the workspace against the Databricks Well-Architected Framework.",
  },
  value_quantification: {
    engine: "business-value",
    label: "Quantify business value",
    href: (scanId) => `/environment?scan=${encodeURIComponent(scanId)}`,
    description: "Attach financial quantification, roadmap phasing, and executive synthesis.",
  },
  governance_risk: {
    engine: "waf",
    label: "Run Well-Architected Assessment",
    href: () => `/assessment`,
    description: "Diagnose governance, security, and access posture against best practice.",
  },
  freshness_risk: {
    engine: "business-value",
    label: "Prioritise remediation",
    href: (scanId) => `/environment?scan=${encodeURIComponent(scanId)}`,
    description: "Rank stale tables by downstream impact for a remediation plan.",
  },
  fragmentation: {
    engine: "opportunities",
    label: "Review fragmentation",
    href: (scanId) => `/environment?scan=${encodeURIComponent(scanId)}`,
    description: "Consolidate duplicated entities built multiple ways across teams.",
  },
};

/** Default action for a finding kind (used when a finding omits its own). */
export function defaultActionFor(kind: EstateFindingKind, scanId: string): EstateAction {
  const def = ESTATE_ACTION_REGISTRY[kind];
  return {
    engine: def.engine,
    label: def.label,
    href: def.href(scanId),
    params: { scanId },
  };
}
