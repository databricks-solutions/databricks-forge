# Forge as a Data Estate Intelligence Platform — Design Doc

> Status: Living design doc for the Estate Intelligence rebuild. This is the
> gate before coding (per the build prompt in
> `docs/prompts/ESTATE_SCAN_CONSULTANT_GRADE_REBUILD.md` §6.1). It resolves the
> §11 open decisions, defines the data model and API surface, the federation /
> provenance model, the org-admin security model, the component tree, and the
> V1 / V2 migration plan.

## 1. The reframe

Forge is re-founded as a **Data Estate Intelligence platform**. There is **one
persistent, living world model of the customer's data estate at the center**,
and every engine becomes an **action on that model** rather than a standalone
pipeline. The estate is the noun; engines are verbs.

The new front door is the **State of the Nation** — a management-consultant-grade
diagnosis of the estate. Discovery does not die; it becomes **"Opportunities"**,
invoked *from* the estate with full context.

Operating loop (the spine):

```
UNDERSTAND -> DIAGNOSE -> PRIORITISE -> ACT -> MEASURE -> (re-scan) UNDERSTAND
  scan        state of    uplift +     engines  re-scan,
              the nation   opportunity  as next- track drift
                           backlog      best actions
```

Three altitudes (one continuous drill-down):

- **Portfolio** (CDO/CIO, V2) — across all teams/workspaces.
- **Estate** (data lead/architect, V1) — one estate (one or many scopes rolled up).
- **Asset** (engineer/steward, V1) — a table / data product / column.

Drill spine: Portfolio -> Estate -> Domain -> Data Product -> Table -> Column.

## 2. Resolved decisions (build prompt §11)

### 2.1 Federation approach (§11.1) — UC / system-tables, single host

Customer reality (confirmed): everything is in **one Unity Catalog metastore**,
and Forge runs from a workspace that has **cross-workspace read access** to all
data. Therefore federation is **provenance-aware roll-up within one host**, not a
cross-host export/import pipeline.

- No artifact import. The hub already sees the whole metastore through one
  `DATABRICKS_HOST` / one OBO token / one warehouse.
- We capture **`workspaceId` + `teamLabel` provenance** per scope and per scan so
  the portfolio can attribute estates to teams/workspaces.
- Workspace/team attribution is derived from the scope's catalog grouping and,
  where available, `system.access.*`. Provenance is set at scope-creation time
  (explicit `teamLabel`) and stamped onto the resulting scan.
- This is **designed in V1** (columns + plumbing) and **surfaced in V2** (the
  portfolio aggregator).

Rejected alternatives: (a) hub-and-spoke export/import — unnecessary given
cross-workspace UC access, adds an artifact schema + import surface for no gain;
(c) a `databricks` connector in `lib/connections` — only needed if Forge could
*not* read across workspaces, which is not the case here. The connector
abstraction is left untouched for the genuinely external (Fabric) case.

### 2.2 Scopes data model (§11.2) — repurpose `ForgeEstateProgram` as the Estate

Lowest-risk migration. Keep the proven sequencing mechanics
(`claimNextPlannedScope`, deferred-queue chaining, one scope in flight,
`getAggregateEstateView(programId)`), and **rebrand "Program" to "Estate" in the
API/UI/types layer** without renaming the Prisma model.

- `ForgeEstateProgram` is the **Estate** (the unit the user thinks about).
- `ForgeEstateProgramScope` is an **Estate Scope** (an ordered scan target).
- `ForgeEnvironmentScan` remains the per-scope unit-of-work; `programId` is the
  estate linkage; scans roll up via `getAggregateEstateView`.
- A standalone single-target scan is an **Estate-of-one** (a length-1 sequence).
- Rejected: inverting to `ForgeEstateScanScope` as a child of
  `ForgeEnvironmentScan` (one scan owning many scopes). That is a destructive
  re-keying of every child table and the aggregate path; higher risk for no
  product benefit.

### 2.3 Org-admin / portfolio security model (§11.3) — audited fourth tier

The portfolio is the **only** exception to per-owner isolation. It is modeled on
the existing **WAF qualitative pattern** (a deliberate workspace-wide read
surface), not on `FORGE_USER_ISOLATION=false` (which never relaxes data-layer
filters) and not on N×M ACL shares.

- **Gate 1 — feature flag:** `FORGE_PORTFOLIO_ENABLED` (default off). When off,
  the portfolio routes 404 and the nav item is hidden.
- **Gate 2 — role allowlist:** `FORGE_ORG_ADMIN_EMAILS` (comma-separated). A
  caller must be on the allowlist to read the portfolio. Implemented as
  `isOrgAdmin(email)` in `lib/config/portfolio-flag.ts`. (Future: promote to a
  `ForgeAppConfig`-backed role list editable in Settings, same pattern as
  `demoModeEnabled`.)
- **Read-only:** portfolio routes never mutate. The cross-owner aggregator
  (`lib/lakebase/portfolio-estate.ts`) intentionally omits the `ownerEmail`
  filter and is reachable **only** through the gated routes.
- **Audited:** every portfolio read/export logs `portfolio_viewed` /
  `portfolio_exported` via `logActivity` with the admin email.
- **Documented:** this section is the security model of record. Per-owner
  isolation remains the default for every other surface.

### 2.4 Workload inventory breadth (§11.4) — v1 set

Inventory in v1: **dashboards, Genie spaces, UC models, UC functions** (reuse
`discoverExistingAssets` + the UC model/function inventory already in
`standalone-scan.ts`). Deferred to v2: jobs, pipelines, apps (need additional
APIs/scopes and are lower-signal for the diagnosis).

### 2.5 Cross-team entity resolution (§11.5) — embeddings-based

Run as a **portfolio synthesis pass** (V2). Resolve duplicated/conflicting
canonical entities across estates using the existing pgvector store over
`canonical_entity` insight embeddings, with a deterministic name-normalisation
fallback. Output: clusters of "the same entity built N ways" with per-cluster
team provenance and a recommended canonical owner.

### 2.6 Naming / IA (§11.6)

- Spine nouns: **Estate** (single), **Portfolio** (cross-team).
- Landing: **State of the Nation**.
- Discovery: **Opportunities**.
- Engine CTAs: **Actions**.
- Remove **Estate Programs** from the nav; `app/environment/programs/**` is
  retired once parity is reached.

### 2.7 Phasing (§11.7)

- **V1** — single-estate consultant-grade, shipped fully tested: data model +
  migration, correctness bugs, persisted world model, consultant synthesis layer
  (evidence + exec brief + estate data-gap + cost + WAF posture), sequenced runs
  with pause/cancel/resume, engines-as-actions, the Estate State-of-the-Nation
  UX + full drill-down, API consolidation, exports, i18n, tests.
- **V2** — UC-federated portfolio: org-admin tier, enterprise inventory,
  cross-estate fragmentation, federated opportunities, org uplift plan, the
  Portfolio landing + board pack. (There is no "team" dimension — Forge has no
  defined team entity, so the portfolio rolls up by estate, not by team.)

The V1 data model carries provenance so V2 does not require a second migration.

## 3. Data model

Forward-only Prisma migrations; `npx prisma generate` after each change. New root
models carry `ownerEmail String?` + `@@index([ownerEmail])`. All new tables are
added to `deleteAllData()` in `lib/lakebase/reset.ts`.

### 3.1 Changes to existing models

- `ForgeEnvironmentScan`
  - Persist `excludedScope` / `exclusionPatterns` (columns exist; never written —
    bug 6). Write them in `saveEnvironmentScan`.
  - Add provenance: `workspaceId String?`, `teamLabel String?`.
- `ForgeTableDetail`
  - Add `dataAssetId String?`, `dataAssetName String?` (industry asset mapping at
    scan scope; required for estate data-gap).
  - Add `tierReasoning String?` (today the LLM tier reasoning is discarded).
  - **Fix `governanceScore`** to store `GovernanceGap.overallScore` (bug 1), not
    the rule-based health score.
- `ForgeEstateProgram` (the Estate)
  - Add `subVertical String?` (industry sub-vertical threading).
- `ForgeEstateProgramScope` (the Estate Scope)
  - Extend status set with `paused` and `cancelled`.
  - Add provenance `workspaceId String?`, `teamLabel String?`.
- Unique constraints to make the two-phase save idempotent (bug 3):
  - `ForgeTableLineage @@unique([scanId, sourceTableFqn, targetTableFqn, entityType])`
  - `ForgeTableInsight` foreign-key insight idempotency handled by a guarded
    checkpoint save (the checkpoint stops writing FK/lineage; final save owns
    them) rather than a unique constraint, because `payloadJson` is free-form.

### 3.2 New model — `ForgeEstateSynthesis`

The persisted consultant-grade synthesis (one row per scan, optionally one per
estate roll-up).

```
model ForgeEstateSynthesis {
  id              String   @id @default(uuid())
  scanId          String?  @map("scan_id")
  estateId        String?  @map("estate_id")   // ForgeEstateProgram.id
  ownerEmail      String?  @map("owner_email")
  industryId      String?  @map("industry_id")
  briefJson       String   @map("brief_json")        // ExecutiveBrief
  findingsJson    String   @map("findings_json")     // EstateFinding[] (with Action + Evidence[])
  evidenceJson    String?  @map("evidence_json")     // flat Evidence[] index
  valueAtRiskJson String?  @map("value_at_risk_json")
  scoresJson      String?  @map("scores_json")       // sub-scores: governance/quality/freshness/docs/analytics/cost
  passResultsJson String?  @map("pass_results_json")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([scanId])
  @@index([estateId])
  @@index([ownerEmail])
  @@map("forge_estate_synthesis")
}
```

### 3.3 New domain types (`lib/domain/estate-synthesis-types.ts`)

- Reuse `EvidenceTier` / `Evidence` verbatim from
  `lib/demo/research-engine/types.ts`.
- `ExecutiveBrief` (Situation / Complication / Resolution + sections), modeled on
  the research engine's brief.
- `EstateFinding`: `{ id, kind, severity, title, summary, evidence: Evidence[],
  action: EstateAction }`.
- `EstateAction`: `{ engine, label, href, params }` mapping a finding to a Forge
  engine route.
- `EstateScores`: the six sub-scores (governance, quality/health, freshness,
  documentation, analytics maturity, cost) + overall + band.

## 4. API surface

All routes enforce `requireUser` (the `proxy.ts` edge gate plus explicit
`requireUser` in handlers) and scope by `ownerEmail` ∪ `listAccessibleIds`,
except the audited portfolio tier.

### 4.1 V1 — estate routes (consolidating estate-programs)

- `GET/POST /api/environment-scan` — list / start scans (unchanged; estate-of-one).
- `GET /api/environment/aggregate` — aggregate estate view (+ server-side
  maturity, fixing the zeroed inputs).
- `GET /api/environment/[scanId]/data-gap` — read latest estate data-gap
  (compute-on-miss).
- `POST /api/environment/[scanId]/data-gap` — recompute + persist (`scanId`).
- `GET /api/environment/[scanId]/synthesis` — read persisted `ForgeEstateSynthesis`.
- `POST /api/environment/[scanId]/synthesis` — (re)generate synthesis.
- `GET /api/environment/trends` — scoped to the estate (today it compares the two
  most recent global scans).
- Estate management (replaces `/api/estate-programs/**`), all under
  `/api/estate/[estateId]`:
  - `GET/PATCH/DELETE /api/estate/[estateId]`
  - `GET /api/estate/[estateId]/aggregate`
  - `POST /api/estate/[estateId]/scopes`, `DELETE .../scopes/[scopeId]`
  - `POST /api/estate/[estateId]/run` — start/resume the sequence.
  - `POST /api/estate/[estateId]/pause`, `.../cancel`, `.../resume`.
  - `GET /api/estate/[estateId]/export?format=pdf|excel`.
- Existing `/api/estate-programs/**` routes are kept as **thin compatibility
  shims** that forward to the new handlers for one release, then deleted.

### 4.2 V2 — portfolio routes (gated)

- `GET /api/portfolio` — enterprise inventory + estate roll-up (org-admin only).
- `GET /api/portfolio/fragmentation` — cross-estate entity resolution clusters.
- `GET /api/portfolio/opportunities` — federated industry-mapped opportunities.
- `GET /api/portfolio/uplift` — org operating-model uplift plan.
- `GET /api/portfolio/export?format=pdf` — portfolio board pack.

## 5. Engines (`lib/ai/estate-synthesis/`, `lib/ai/portfolio-synthesis/`)

- **Estate synthesis (V1)** — modeled on `lib/demo/research-engine/engine.ts`
  and `lib/pipeline/steps/business-value-analysis.ts`:
  - Fan-out independent scoring passes (`Promise.allSettled`) ->
    estate-level executive-brief pass -> evidence-tiering pass.
  - Inputs: persisted scan details/insights/`scanSummaryJson` + master repo
    (`industry-outcomes-server`) + estate data-gap + latest WAF posture +
    cost modeling (`lib/domain/cost-modeling.ts`).
  - Per-pass graceful skip + `passResultsJson`; never block a scan on synthesis
    failure (BV degraded-flag pattern). In-memory status mirror like
    `lib/genie/engine-status.ts`.
  - Persist to `ForgeEstateSynthesis`.
- **Portfolio synthesis (V2)** — elevates the canonical-entity pass to portfolio
  scope (embeddings entity resolution), cross-estate fragmentation, federated
  opportunities, org uplift plan.

## 6. Federation / provenance model

- Provenance is captured per **scope** (`workspaceId`) and stamped onto each
  resulting **scan**. (Note: there is no `team` concept in Forge — the dormant
  `teamLabel` column is unused and the portfolio never groups by team.)
- The portfolio aggregator reads scans across owners (gated) and rolls them up
  by **estate** (`ForgeEstateProgram` or standalone scan) to produce the
  enterprise inventory and cross-estate fragmentation.
- Privacy: metadata-only across the board (schemas, names, history, tags) — never
  row-level data, including in the portfolio.

## 7. Component tree (UX)

Rebuild `app/environment/**` + `components/environment/**` into the spine.
Charts use **recharts** (already in repo) for distributions/quadrants/gauges;
**React Flow** (`@xyflow/react`, already in repo) for the lineage map. Every
surface has loading / empty / error states and one dominant primary CTA. Reuse
`CatalogBrowser`, `SemanticSearchInput`, `stat-card.tsx`.

- `app/environment/page.tsx` — **Estate State of the Nation** (landing):
  readiness scorecard with the six sub-scores, evidence-backed exec brief,
  top-3 strengths / risks / quick-wins (click-through to evidence), domain
  maturity quadrant/heatmap, tier/freshness/health distributions, coverage
  gauges. No badge integers, no zeroed inputs.
- Domain explorer, Data products view (Pass-7 products promoted from Excel-only),
  Lineage map (freshness propagation, upgrades `erd-viewer.tsx`),
  Quality & freshness (interactive/sortable/drill-down), Governance (real
  `GovernanceGap` + corrected score), Asset drill-down (promote + link
  `app/environment/table/[fqn]/page.tsx` from every table reference),
  Sequenced-run management (add/reorder/remove scopes, start/pause/cancel/resume,
  live per-scope progress).
- V2: `app/portfolio/page.tsx` — Portfolio State of the Nation.
- Nav: remove "Estate Programs"; add "Estate" / (V2) "Portfolio" to
  `components/pipeline/sidebar-nav.tsx`.

## 8. Engines as next-best-actions

A findings-to-action registry (`lib/domain/estate-actions.ts`) maps each
`EstateFinding.kind` to a Forge engine route:

- Opportunity / outcome-map gap -> Opportunities (discovery invoked from the
  estate via `sourceScanId` reconstitution).
- Documentation gap -> Comment Engine.
- Query-ready domain -> Genie space stand-up.
- Coverage / data gap -> Data-Gap remediation.
- Well-architected gap -> WAF Assessment.
- Value quantification / roadmap -> Business Value engine.

Discovery is no longer a front door; it is the grounded payoff. A power-user path
to run engines directly remains.

## 9. Testing strategy (full e2e)

- **Unit (Vitest):** synthesis scoring + evidence tiering; scope state machine
  (planned/queued/running/complete/failed/paused/cancelled + stuck-queued
  reclaim); estate data-gap mapping; governance-score fix; cost wiring;
  cross-team entity resolution; new row-to-type mappers; new Zod schemas;
  portfolio aggregation.
- **Integration (Vitest + DI ports):** each new/changed API route with mocked
  `requireUser`/OBO; engine -> Lakebase persistence round-trips via the existing
  `deps` injection; isolation assertions (non-owner blocked; org-admin allowed
  only when flagged).
- Gate: `npm run typecheck`, `npm run lint`, `npm test` all green; `AGENTS.md`
  and `docs/estate-analysis.md` updated.

## 10. Integration checklist (AGENTS.md)

- Factory reset: add `ForgeEstateSynthesis` (and V2 portfolio tables) to
  `deleteAllData()`.
- Activity logging: add `estate_synthesis_generated`, `estate_data_gap_computed`,
  `estate_sequence_paused`, `estate_sequence_cancelled`, `estate_sequence_resumed`,
  `portfolio_viewed`, `portfolio_exported`.
- Navigation: update `components/pipeline/sidebar-nav.tsx`.
- Docs: update `AGENTS.md` + `docs/estate-analysis.md`.
- Prisma indexes + `ownerEmail` on new root models.
- SQL-injection protection: identifiers via `validateFqn` / `validateIdentifier`;
  literals via `escapeComment`.
- Component reuse: `CatalogBrowser`, `SemanticSearchInput`, `stat-card.tsx`.
- Isolation: owner-scope everywhere except the audited portfolio tier.
- Embeddings scope: register any new vector kind (V2 portfolio entity
  embeddings) in `lib/embeddings/kind-scope.ts`.
- Quotas: sequenced scans respect `FORGE_MAX_ACTIVE_SCANS_PER_USER`.
