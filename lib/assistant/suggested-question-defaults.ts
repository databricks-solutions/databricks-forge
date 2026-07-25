/**
 * Fallback suggested questions for the Ask Forge empty state.
 *
 * Separated from suggested-questions.ts to avoid pulling server-only
 * dependencies (prisma/pg) into client component bundles.
 */

export const FALLBACK_QUESTIONS = [
  "How can I calculate Customer Lifetime Value?",
  "Which tables have PII data?",
  "Show me revenue trends by region",
  "What data quality issues exist?",
];

export const FALLBACK_QUESTIONS_ANALYST = [
  "What KPIs can we track from our data?",
  "Which data sources support a revenue dashboard?",
  "How can we measure customer retention?",
  "Show me what dimensions we can slice sales by",
];

export const FALLBACK_QUESTIONS_TECH = [
  "Which tables need VACUUM or OPTIMIZE?",
  "Show me tables with stale data (no writes in 30+ days)",
  "What schema drift or governance gaps exist?",
  "Which tables have the most downstream dependencies?",
];

export const FALLBACK_QUESTIONS_STRATEGIC = [
  "What is the total estimated business value of our discovered use cases?",
  "Which domains have the highest ROI potential and what should we prioritise?",
  "Draft a board-level summary of our data estate readiness and recommended investments",
  "What are the key risks to our data strategy and how should we mitigate them?",
];
