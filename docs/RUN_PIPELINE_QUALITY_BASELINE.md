# Run Pipeline Quality Baseline

## Objective

Define a repeatable quality baseline for pipeline runs so we can detect AI slop,
track improvements, and enforce consultant-grade standards.

## Baseline metrics

Implemented in `lib/pipeline/run-quality.ts`:

- `totalUseCases`
- `sqlGeneratedRate`
- `schemaCoveragePct`
- `avgOverallScore`
- `lowSpecificityRate`
- `duplicateNameRate`
- `groundedUseCaseRate`
- `consultantReadinessScore`
- `findings` (human-readable diagnostic flags)

## Quality interpretation

- **Consultant readiness** should trend upward and remain stable by industry.
- **Low specificity** and **duplicate name** rates are anti-slop canaries.
- **Grounded rate** and **SQL generated rate** reflect output actionability.
- **Schema coverage** detects whether we are over-indexing on only a subset of tables.

## Initial thresholds

- `consultantReadinessScore >= 0.75`
- `lowSpecificityRate <= 0.20`
- `duplicateNameRate <= 0.10`
- `groundedUseCaseRate >= 0.95`
- `sqlGeneratedRate >= 0.80`
- `schemaCoveragePct >= 0.30` for medium+ estates

Thresholds should be tuned per customer maturity and discovery depth.

## Governance use

- Compute baseline metrics at the end of each run.
- Persist metrics in run metadata for trend analysis.
- Fail quality gate (or flag run) when core thresholds are missed.
- Review monthly per industry for prompt and scoring drift.
