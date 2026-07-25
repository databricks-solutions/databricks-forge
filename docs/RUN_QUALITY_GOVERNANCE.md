# Run Quality Governance

## Goal

Maintain consultant-grade run outputs through explicit quality gates, metrics,
and recurring review.

## Runtime quality loop

1. Generate use cases.
2. Apply deterministic anti-slop validation (`lib/pipeline/usecase-quality.ts`).
3. Score and calibrate use cases.
4. Compute run baseline metrics (`lib/pipeline/run-quality.ts`).
5. Persist governance KPIs to `forge_quality_metrics`.
6. Enforce consultant readiness threshold (`FORGE_MIN_CONSULTANT_READINESS`).
7. Fail run when quality gate is not met.

## KPI set

- Consultant readiness score
- Low specificity rate
- Duplicate name rate
- Grounded use case rate
- SQL generated rate
- Schema coverage percent

## Operating cadence

- Weekly: inspect failing runs and top findings.
- Monthly: calibration review for thresholds, prompt changes, and anti-slop filters.
- Quarterly: benchmark source refresh and lifecycle retirement for stale packs.

## Regression safety

- Unit tests in `__tests__/pipeline/run-quality.test.ts`.
- Add additional regression fixtures when new anti-slop patterns are detected.
