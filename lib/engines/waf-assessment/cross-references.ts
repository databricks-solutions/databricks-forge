/**
 * AWS and Azure Well-Architected Framework cross-references for the
 * Databricks WAF controls.
 *
 * Surfaces a per-pillar fallback (every Databricks pillar maps to an
 * AWS / Azure WAF pillar) plus an optional per-control override when the
 * official Databricks WAF spreadsheet documents a specific cross-reference.
 *
 * Used by the UI to render "AWS WAF: Security" / "Azure WAF: Reliability"
 * link-outs alongside each control. Static data — no DB hit.
 */

import type { WafPillar } from "./types";

export interface WafCrossReference {
  awsLabel: string;
  awsHref: string;
  azureLabel: string;
  azureHref: string;
}

const AWS_PILLARS = {
  operational: {
    label: "AWS WAF · Operational Excellence",
    href: "https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html",
  },
  security: {
    label: "AWS WAF · Security",
    href: "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html",
  },
  reliability: {
    label: "AWS WAF · Reliability",
    href: "https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html",
  },
  performance: {
    label: "AWS WAF · Performance Efficiency",
    href: "https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html",
  },
  cost: {
    label: "AWS WAF · Cost Optimization",
    href: "https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html",
  },
} as const;

const AZURE_PILLARS = {
  operational: {
    label: "Azure WAF · Operational Excellence",
    href: "https://learn.microsoft.com/azure/well-architected/operational-excellence/",
  },
  security: {
    label: "Azure WAF · Security",
    href: "https://learn.microsoft.com/azure/well-architected/security/",
  },
  reliability: {
    label: "Azure WAF · Reliability",
    href: "https://learn.microsoft.com/azure/well-architected/reliability/",
  },
  performance: {
    label: "Azure WAF · Performance Efficiency",
    href: "https://learn.microsoft.com/azure/well-architected/performance-efficiency/",
  },
  cost: {
    label: "Azure WAF · Cost Optimization",
    href: "https://learn.microsoft.com/azure/well-architected/cost-optimization/",
  },
} as const;

/** Pillar-level fallback — every Databricks pillar maps to an AWS / Azure pillar. */
const PILLAR_REFS: Record<WafPillar, WafCrossReference> = {
  governance: {
    awsLabel: AWS_PILLARS.security.label,
    awsHref: AWS_PILLARS.security.href,
    azureLabel: AZURE_PILLARS.security.label,
    azureHref: AZURE_PILLARS.security.href,
  },
  interoperability_usability: {
    awsLabel: AWS_PILLARS.operational.label,
    awsHref: AWS_PILLARS.operational.href,
    azureLabel: AZURE_PILLARS.operational.label,
    azureHref: AZURE_PILLARS.operational.href,
  },
  operational_excellence: {
    awsLabel: AWS_PILLARS.operational.label,
    awsHref: AWS_PILLARS.operational.href,
    azureLabel: AZURE_PILLARS.operational.label,
    azureHref: AZURE_PILLARS.operational.href,
  },
  security_compliance_privacy: {
    awsLabel: AWS_PILLARS.security.label,
    awsHref: AWS_PILLARS.security.href,
    azureLabel: AZURE_PILLARS.security.label,
    azureHref: AZURE_PILLARS.security.href,
  },
  reliability: {
    awsLabel: AWS_PILLARS.reliability.label,
    awsHref: AWS_PILLARS.reliability.href,
    azureLabel: AZURE_PILLARS.reliability.label,
    azureHref: AZURE_PILLARS.reliability.href,
  },
  performance_efficiency: {
    awsLabel: AWS_PILLARS.performance.label,
    awsHref: AWS_PILLARS.performance.href,
    azureLabel: AZURE_PILLARS.performance.label,
    azureHref: AZURE_PILLARS.performance.href,
  },
  cost_optimisation: {
    awsLabel: AWS_PILLARS.cost.label,
    awsHref: AWS_PILLARS.cost.href,
    azureLabel: AZURE_PILLARS.cost.label,
    azureHref: AZURE_PILLARS.cost.href,
  },
};

/**
 * Per-control overrides — link directly to a specific AWS / Azure WAF
 * design principle or guidance page. Add entries here as the team verifies
 * the official Databricks WAF spreadsheet's "AWS reference" / "Azure reference"
 * columns for each control. Anything not listed falls back to the pillar URL.
 */
const CONTROL_REFS: Record<string, Partial<WafCrossReference>> = {
  // Governance — audit / monitoring
  "DG-02-02": {
    awsLabel: "AWS WAF · SEC04 Detect & investigate security events",
    awsHref:
      "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec04.html",
    azureLabel: "Azure WAF · Security – monitor & threat protection",
    azureHref:
      "https://learn.microsoft.com/azure/well-architected/security/monitor-threats",
  },
  // Cost — right-sizing
  "CO-01-09": {
    awsLabel: "AWS WAF · COST06 Choose appropriate resource type, size & number",
    awsHref:
      "https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost-effective-resources.html",
    azureLabel: "Azure WAF · Cost – optimize component costs",
    azureHref:
      "https://learn.microsoft.com/azure/well-architected/cost-optimization/optimize-component-costs",
  },
  // Performance — auto-scaling
  "PE-02-04": {
    awsLabel: "AWS WAF · PERF02 Compute and hardware",
    awsHref:
      "https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/compute-and-hardware.html",
    azureLabel: "Azure WAF · Performance – plan for scaling",
    azureHref:
      "https://learn.microsoft.com/azure/well-architected/performance-efficiency/scale",
  },
  // Reliability — DLT expectations
  "R-01-03": {
    awsLabel: "AWS WAF · REL08 Design your workload to withstand component failures",
    awsHref:
      "https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/design-your-workload-to-withstand-component-failures.html",
    azureLabel: "Azure WAF · Reliability – validate data integrity",
    azureHref:
      "https://learn.microsoft.com/azure/well-architected/reliability/data-integrity",
  },
  // Security — service principals
  "SCP-01-13": {
    awsLabel: "AWS WAF · SEC02 Identity & access management",
    awsHref:
      "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec02.html",
    azureLabel: "Azure WAF · Security – identity & access management",
    azureHref:
      "https://learn.microsoft.com/azure/well-architected/security/identity-access",
  },
};

/** Resolve the AWS / Azure cross-reference for a single control. */
export function getCrossReference(wafId: string, pillar: WafPillar): WafCrossReference {
  const fallback = PILLAR_REFS[pillar];
  const override = CONTROL_REFS[wafId];
  if (!override) return fallback;
  return {
    awsLabel: override.awsLabel ?? fallback.awsLabel,
    awsHref: override.awsHref ?? fallback.awsHref,
    azureLabel: override.azureLabel ?? fallback.azureLabel,
    azureHref: override.azureHref ?? fallback.azureHref,
  };
}
