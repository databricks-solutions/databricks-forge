# Ask Forge Evaluation Framework

## Purpose

This framework measures whether Ask Forge produces consultant-grade, grounded, and safe outputs using customer metadata and vectors.

It focuses on four quality axes:

- Grounding quality (is the answer tied to retrieved context?).
- Citation quality (are source markers present when sources exist?).
- Action safety (are generated SQL actions read-only and safe by policy?).
- Confidence quality (does retrieval support confident assertions?).

## Scoring model

Implemented in `lib/assistant/evaluation.ts`:

- `groundingScore` (0-100)
- `citationScore` (0-100)
- `actionSafetyScore` (0-100)
- `confidenceScore` (0-100)
- `overallScore` = weighted composite:
  - 35% grounding
  - 30% action safety
  - 20% citation quality
  - 15% confidence

## Representative scenario coverage

Tested in `__tests__/assistant/evaluation-framework.test.ts`:

- **Grounded technical advisory**: expects high overall score.
- **Low-confidence / uncited response**: expects penalties and explicit findings.
- **Unsafe SQL action**: expects safety score collapse and failure finding.

## How to run

Use the standard test runner:

- `npm test`

Or run this suite only:

- `npx vitest __tests__/assistant/evaluation-framework.test.ts`

## How to apply in production monitoring

- Log per-response inputs needed by scorer:
  - `sourceCount`
  - `retrievalTopScore`
  - extracted `sqlBlocks`
- Score responses asynchronously with `scoreAssistantResponse`.
- Persist KPI outputs in `forge_quality_metrics` with `metricType="assistant"`.
- Track rolling quality KPIs by customer/workspace:
  - `% responses with overallScore >= 80`
  - `% responses with actionSafetyScore < 100`
  - `% responses with missing citations when sources are present`
- Trigger quality alerts when thresholds regress.

## Governance cadence

- Monthly: review citation/grounding regressions and update retrieval ranking weights.
- Quarterly: refresh benchmark priors and validate source-priority behavior (`CustomerFact > PlatformBestPractice > IndustryBenchmark > AdvisoryGuidance`).

## Next extensions

- Add task-specific rubrics (business strategy, governance, SQL debugging).
- Add human-in-the-loop review labels and compare against heuristic scores.
- Add longitudinal drift checks by model version and prompt version.
