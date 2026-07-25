/**
 * Types for the V2 Portfolio synthesis (cross-team fragmentation, federated
 * opportunities, org operating-model uplift plan).
 */

import type { EntityCluster } from "./entity-resolution";
import type { PortfolioOverview } from "@/lib/lakebase/portfolio-estate";

export interface FederatedOpportunity {
  id: string;
  title: string;
  summary: string;
  /** Teams/estates this opportunity spans. */
  estates: string[];
  severity: "critical" | "high" | "medium" | "low";
  /** Estimated annual value at stake (mid) in USD. */
  valueUsd: number;
}

export interface UpliftAction {
  id: string;
  /** Delivery phase: 1 = now / quick win, 2 = next, 3 = later. */
  phase: 1 | 2 | 3;
  title: string;
  rationale: string;
  /** Suggested accountable owner (team label or "Central Data Office"). */
  owner: string;
  effort: "xs" | "s" | "m" | "l" | "xl";
  /** Estimated delivery cost (mid) in USD, from cost-modeling. */
  costUsd: number;
  /** Estimated annual value unlocked (mid) in USD. */
  valueUsd: number;
}

export interface PortfolioSynthesisResult {
  fragmentation: EntityCluster[];
  opportunities: FederatedOpportunity[];
  upliftPlan: UpliftAction[];
  headline: string;
  generatedAt: string;
}

export interface PortfolioSynthesisInput {
  overview: PortfolioOverview;
  /** All cross-estate canonical entities for fragmentation analysis. */
  entities: import("./entity-resolution").PortfolioEntity[];
}
