/**
 * Types for the Estate Synthesis engine (consultant-grade State of the Nation).
 *
 * The engine takes a compact, already-persisted view of one scan (the world
 * model) plus optional cross-engine signals (data-gap, WAF, cost) and produces
 * an `EstateSynthesisResult` (scores + evidence-tiered exec brief + findings).
 */

import type {
  EstateSynthesisResult,
  EstateScores,
  EstateFinding,
  ExecutiveBrief,
  Evidence,
} from "@/lib/domain/estate-synthesis-types";

export type {
  EstateSynthesisResult,
  EstateScores,
  EstateFinding,
  ExecutiveBrief,
  Evidence,
};

/** A single table as the synthesis engine sees it (subset of TableDetail). */
export interface SynthTable {
  fqn: string;
  dataDomain: string | null;
  dataTier: string | null;
  comment: string | null;
  generatedDescription: string | null;
  governanceScore: number | null;
  sensitivityLevel: string | null;
  owner: string | null;
  /** ISO timestamp of last modification (from history or table metadata). */
  lastWriteAt: string | null;
  /** Rule-based health score (0-100) from the history pass. */
  healthScore: number | null;
}

/** A persisted insight row (subset). */
export interface SynthInsight {
  insightType: string;
  tableFqn: string | null;
  payloadJson: string;
  severity: string;
}

/** Optional data-gap signal folded into the synthesis. */
export interface SynthDataGap {
  industryId: string;
  industryName: string;
  missingAssets: number;
  mcMissing: number;
  valueAtRiskLow: number;
  valueAtRiskMid: number;
  valueAtRiskHigh: number;
}

/** Optional WAF posture signal. */
export interface SynthWaf {
  overallScore: number; // 0-100
}

export interface EstateSynthesisInput {
  scanId: string;
  ucPath: string;
  industryId?: string | null;
  industryName?: string | null;
  tables: SynthTable[];
  insights: SynthInsight[];
  /** Estate-level readiness band/score from the scan summary, if present. */
  readinessScore?: number | null;
  /** Analytics maturity score (0-100), if present. */
  analyticsMaturityScore?: number | null;
  dataGap?: SynthDataGap | null;
  waf?: SynthWaf | null;
  /** Estimated annualised storage+compute waste in USD, if modeled. */
  costWasteUsd?: number | null;
}

/** Dependencies injected into the engine (DI for testability). */
export interface EstateSynthesisDeps {
  /** Returns raw LLM text for a prompt; throws on failure (engine catches). */
  callLLM?: (prompt: string) => Promise<string>;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}
