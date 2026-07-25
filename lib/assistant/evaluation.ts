import { validateReadOnlySql } from "@/lib/assistant/sql-proposer";
import type { AssistantPersona } from "./prompts";

export interface AssistantEvalInput {
  question: string;
  answer: string;
  sourceCount: number;
  retrievalTopScore: number | null;
  sqlBlocks: string[];
  persona?: AssistantPersona;
}

export interface AssistantEvalResult {
  groundingScore: number; // 0-100
  citationScore: number; // 0-100
  actionSafetyScore: number; // 0-100
  confidenceScore: number; // 0-100
  overallScore: number; // 0-100
  findings: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasCitationMarkers(answer: string): boolean {
  return /\[\d+\]/.test(answer);
}

function scoreActionSafety(sqlBlocks: string[], findings: string[]): number {
  if (sqlBlocks.length === 0) return 100;

  let valid = 0;
  for (const sql of sqlBlocks) {
    const err = validateReadOnlySql(sql);
    if (!err) valid++;
    else findings.push(`Unsafe SQL proposal detected: ${err}`);
  }
  return clampScore((valid / sqlBlocks.length) * 100);
}

interface ScoringWeights {
  citation: number;
  grounding: number;
  actionSafety: number;
  confidence: number;
}

function getPersonaWeights(persona: AssistantPersona): ScoringWeights {
  switch (persona) {
    case "business":
      return { citation: 0.0, grounding: 0.45, actionSafety: 0.3, confidence: 0.25 };
    case "analyst":
      return { citation: 0.1, grounding: 0.4, actionSafety: 0.3, confidence: 0.2 };
    case "tech":
      return { citation: 0.2, grounding: 0.35, actionSafety: 0.3, confidence: 0.15 };
    case "strategic":
      return { citation: 0.05, grounding: 0.4, actionSafety: 0.3, confidence: 0.25 };
    default:
      return { citation: 0.0, grounding: 0.45, actionSafety: 0.3, confidence: 0.25 };
  }
}

export function scoreAssistantResponse(input: AssistantEvalInput): AssistantEvalResult {
  const persona = input.persona ?? "business";
  const findings: string[] = [];
  const citationPresent = hasCitationMarkers(input.answer);

  // Business persona is instructed to omit citations; don't penalise absence
  let citationScore: number;
  if (persona === "business") {
    citationScore = 100;
  } else {
    citationScore = citationPresent ? 100 : 0;
    if (input.sourceCount > 0 && !citationPresent) {
      findings.push("Answer has sources but no citation markers.");
    }
  }

  let groundingScore = 100;
  if (input.sourceCount === 0) {
    groundingScore = 30;
    findings.push("No sources were attached to the answer.");
  } else if ((input.retrievalTopScore ?? 0) < 0.5) {
    groundingScore = 60;
    findings.push("Top retrieval score is below 0.5; grounding confidence is limited.");
  }

  const confidenceScore =
    input.retrievalTopScore == null ? 30 : clampScore(input.retrievalTopScore * 100);
  if (input.retrievalTopScore == null) {
    findings.push("No retrieval score available for confidence estimation.");
  }

  const actionSafetyScore = scoreActionSafety(input.sqlBlocks, findings);
  const w = getPersonaWeights(persona);
  const overallScore = clampScore(
    citationScore * w.citation +
      groundingScore * w.grounding +
      actionSafetyScore * w.actionSafety +
      confidenceScore * w.confidence,
  );

  return {
    groundingScore,
    citationScore,
    actionSafetyScore,
    confidenceScore,
    overallScore,
    findings,
  };
}
