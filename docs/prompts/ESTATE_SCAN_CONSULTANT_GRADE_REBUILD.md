# BUILD PROMPT — Forge as a Data Estate Intelligence Platform

> Paste this whole document as the task prompt for an agent that will first
> **produce an implementation plan**, then build it, in the `databricks-forge`
> repo. It is grounded in the current implementation (file paths and symbols are
> real — read them before planning). Follow `AGENTS.md`, the workspace rules, and
> the **New Feature Integration Checklist** in `AGENTS.md`.
>
> **Your first deliverable is a written implementation plan** (a design doc in
> `docs/`) that makes the open decisions in §11 explicit, sequences the work,
> and defines the data model and API surface. Do not start coding until the plan
> is written.

---

## 1. The Reframe (read this first — it changes what Forge *is*)

Forge today is a **toolbox of engines** — discovery, estate scan, Genie,
comments, WAF, data-gap, business value — with the **discovery pipeline** (scan
→ scored use cases → auto-built SQL) as the front door. That is backwards: it
asks the customer's most advanced question ("generate me solutions") before they
can answer the most basic one ("what do I even have?"). No consultant builds you
a solution on day one — they **assess, diagnose, recommend, then execute.**

**This work re-founds Forge as a Data Estate Intelligence platform.** There is
**one persistent, living model of the customer's data estate at the center**, and
every engine becomes an **action on that model** rather than a standalone
pipeline. The estate is the noun; everything else is a verb.

The new front door is the **State of the Nation** — a management-consultant-grade
diagnosis of the estate. The discovery pipeline does **not** die: it becomes
**"Opportunities,"** invoked *from* the estate with full context, so it fires
smarter (grounded in real domains, products, lineage, and gaps) and lands as the
satisfying payoff of a diagnosis the customer already believes.

### The operating rhythm (the system's spine)

Everything snaps to one legible loop. The user always knows where they are and
what the single next step is. It is a **loop, not a pipeline** — the estate is
re-scanned, drift is detected, new risk and opportunity surface over time.

```
        ┌───────────────────────────────────────────────┐
        │                                               ▼
   UNDERSTAND  →  DIAGNOSE  →  PRIORITISE  →  ACT  →  MEASURE
   (scan the      (state of    (uplift +     (engines   (re-scan,
    estate)        the nation)   opportunity   as next-   track drift
                                 backlog)      best       over time)
                                              actions)
```

### What makes it feel *intelligent* (not a re-skin)

1. **One world model.** The estate scan produces a single enriched model
   (domains → data products → tables → columns + lineage + health + ontology +
   evidence). `lib/metadata/buildSchemaContext()` is already designed as an
   extractable, dependency-free context object — make it the substrate.
2. **Every engine reads/writes it.** Discovery, Genie, Comments, Data-Gap all
   consume the same context instead of re-scanning cold; acting on the estate
   *improves* the model (comments raise the documentation score; discovery adds
   opportunities). The estate gets smarter every time you use Forge.
3. **It has memory.** Re-scans track drift (the trends infra exists —
   `/api/environment/trends`, `scan-trends-panel.tsx`); the estate compares to
   prior state and proactively flags new risks ("3 new ungoverned PII tables
   since last month").
4. **Everything is evidenced.** Every claim is `sourced` / `benchmark` /
   `inferred` so it is defensible to a board.
5. **Diagnosis is the navigation to the cure.** Every finding carries a Forge
   action that resolves it.

---

## 2. The Executive Test This Must Pass

Persona: a **C-level exec at Petronas (a National Oil Company)** trying to
understand what **50 teams in isolated workspaces** have built. The rebuild is
successful only if it answers, **at enterprise scale**:

1. **What do I have?** — across all teams/workspaces, not one at a time.
2. **Where are my quality gaps?** — including *cross-team* fragmentation and a
   team-vs-team view, not just within one estate.
3. **What's my uplift plan?** — an org operating-model plan with owners, phasing,
   and dollars — not just per-table fixes.
4. **What use cases align to my industry outcome maps?** — federated across
   teams, mapped to the NOC / energy Master Repo, as a headline output.

A tool that produces 50 beautiful per-team reports and leaves the exec to
assemble the enterprise picture has **failed this test.** This is fundamentally a
**federation + portfolio** problem, not a polish problem.

---

## 3. Three Altitudes (the core information architecture)

The product is one continuous drill-down across three altitudes. A user lands at
the altitude their role implies; every metric is a doorway down.

| Altitude | Persona | The question it answers |
|---|---|---|
| **Portfolio** (new top) | CDO / CIO | "Across all teams/workspaces — what do we have, who's strong vs weak, where's the risk and opportunity?" |
| **Estate** (a team/scan) | Data lead / architect | "What's the state of this estate — domains, products, lineage, quality, freshness?" |
| **Asset** (table / data product) | Engineer / steward | "What is this, is it healthy, who uses it, what do I fix?" |

---

## 4. Current State (read these first)

Architecture is mapped in `docs/estate-analysis.md` and AGENTS.md ("Estate Scan
Pipeline"). Key modules:

| Area | Path |
|------|------|
| Standalone scan orchestrator | `lib/pipeline/standalone-scan.ts` (`runStandaloneEnrichment`) |
| Pipeline metadata-step twin | `lib/pipeline/steps/metadata-extraction.ts` |
| LLM intelligence passes | `lib/ai/environment-intelligence.ts` (`runIntelligenceLayer`) |
| Estate ontology pass | `lib/ai/estate-ontology.ts` (`runEstateOntology`) |
| Asset discovery | `lib/pipeline/steps/asset-discovery.ts` |
| Progress tracking | `lib/pipeline/scan-progress.ts` |
| Scan reconstitution (discovery decoupling) | `lib/pipeline/scan-reconstitution.ts` |
| Program sequencing (to be folded into scans) | `lib/pipeline/estate-program.ts` (`runProgramSequence`) |
| Persistence (scans) | `lib/lakebase/environment-scans.ts` (`getAggregateEstateView`) |
| Persistence (programs → migrate) | `lib/lakebase/estate-programs.ts` |
| Shared world model | `lib/metadata/**` (`buildSchemaContext`, `EnrichedTable`, `SchemaContext`) |
| Domain types | `lib/domain/types.ts`, `lib/domain/estate-tree.ts`, `lib/domain/estate-readiness.ts` |
| Health scoring (10 rules) | `lib/domain/health-score.ts` |
| Cost / consumption | `lib/domain/cost-modeling.ts`, `docs/CONSUMPTION_ESTIMATE.md` |
| Lineage walking | `lib/queries/lineage.ts` |
| Enrichment SQL | `lib/queries/metadata-detail.ts` |
| ERD builder | `lib/export/erd-generator.ts` |
| Excel export (13 sheets) | `lib/export/environment-excel.ts` |
| Industry Master Repos (incl. `oil-gas-noc`, `energy-utilities`, `mining`) | `lib/domain/industry-outcomes/**`, `industry-outcomes-server.ts` |
| Data-gap engine (value-at-risk) | `lib/engines/data-gap-analysis/**` |
| WAF assessment | `lib/engines/waf-assessment/**` |
| External connections (Fabric only today) | `lib/connections/**` |
| Main UI | `app/environment/page.tsx` |
| Program UI (to remove from nav) | `app/environment/programs/**` |
| Table drill-down (orphaned) | `app/environment/table/[fqn]/page.tsx` |
| Components | `components/environment/**` |
| Nav | `components/pipeline/sidebar-nav.tsx` |

### Rich output that already exists but the UI throws away
LLM passes already produce: domains, PII/sensitivity, AI descriptions,
redundancy, implicit relationships, tiers, **data products**, **governance
gaps**, **analytics maturity**, plus ontology (**canonical entities, entity
relationships, business glossary**). Most of this is only visible in the Excel
export. A large part of "make it intelligent" is **surfacing data that already
exists.**

### Correctness bugs to fix as part of this work
- `governanceScore` on `ForgeTableDetail` is set from the **health score**, not
  `GovernanceGap.overallScore` (`saveEnvironmentScan`, `lib/lakebase/environment-scans.ts` ~196).
- `DataMaturityCard` is fed **hardcoded zeros** for tags/lineage/optimize/vacuum
  (`components/environment/aggregate-summary.tsx`).
- Program readiness recomputed client-side instead of reading persisted
  `EstateScanSummary.readinessScore`.
- `ForgeEstateProgram.industryId` is never threaded into
  `runIntelligenceLayer({ industryId })` — industry alignment unused.
- `assetDiscoveryEnabled` defaults off on manual scans → analytics maturity pass
  usually skipped.

### Confirmed facts that shape the design
- The NOC / energy industry content exists (`oil-gas-noc`, `energy-utilities`,
  `mining`, `water-utilities`) with enrichments — Q4 content is available.
- There is **no multi-Databricks-workspace federation.** `lib/connections` is
  `connectorType: "fabric"` only. Forge runs against one `DATABRICKS_HOST` / one
  OBO token / one warehouse.
- `getAggregateEstateView` rolls up only scans the **current user** owns or has
  been shared — there is **no org-wide, cross-owner view.** The isolation model
  (`ownerEmail` ∪ `listAccessibleIds`) actively prevents the CDO view today.

---

## 5. Target Architecture

### 5.1 Tier 1 — The Estate (single scan/team)

Fold "programs" into scans and make the estate a first-class world model.

- **Eliminate the separate "Estate Programs" concept from the UI.** The mental
  model is just **Estate Scans**. Remove programs from `sidebar-nav.tsx`;
  delete/migrate `app/environment/programs/**` once parity is reached.
- **Any scan supports a sequenced run.** A scan owns an **ordered list of
  scopes** (reuse the `ForgeEstateProgramScope` shape: `label`, `ucMetadata`,
  exclusions, `assetDiscoveryEnabled`, `lineageDepth`, `status`, `sequence`,
  `errorMessage`, child segment id) that run in sequence and **roll up into one
  estate view** with per-scope provenance. A single scope is just a sequence of
  length 1. Keep `runProgramSequence`'s proven mechanics (atomic
  `claimNextPlannedScope`, `enqueueDeferredJob` with per-user quota, recursive
  chaining, one scope in flight) renamed to scan-centric terms; add **pause /
  cancel / resume**.
- **Persist the world model.** The scan produces a durable enriched model
  (`SchemaContext`-shaped) — domains, data products, tables, columns, lineage,
  health, ontology, evidence — that other engines consume instead of re-scanning.
- Fix the §4 correctness bugs. Thread `industryId` (incl. sub-vertical) into
  intelligence + synthesis.

### 5.2 Tier 2 — Federation (how 50 isolated workspaces get in)

This is the **gating decision** and must be designed in the plan, not skipped.
Evaluate and choose (document trade-offs):

- **(a) Hub-and-spoke export/import** — Forge-per-workspace produces a portable,
  privacy-safe **estate summary artifact** (metadata + scores + ontology, no row
  data) that is imported into a hub deployment.
- **(b) System-tables / UC federation** — a hub reads `system.*` /
  `information_schema` / `system.access.table_lineage` across workspaces via UC
  federation or Delta Sharing, where governance permits.
- **(c) Connector model** — extend `lib/connections` beyond Fabric to a
  `databricks` connector type for cross-workspace ingestion.

Requirements regardless of choice: capture **workspace/team provenance** on every
estate; handle **scale** (50 estates × thousands of tables — sequencing, LLM
budget, cost); never read row-level data (metadata only).

### 5.3 Tier 3 — Portfolio (the CDO view)

A new top-level view that legitimately aggregates **across owners/teams**:

- **Org-admin role.** A deliberate, audited exception to per-owner isolation
  (NOT a hack) — a role that can read the portfolio. Gate with a feature flag and
  activity logging; document the security model. Per-owner isolation remains the
  default for everyone else.
- **Enterprise inventory** — totals across teams: tables, data products, domains,
  workloads (dashboards, Genie spaces, models, jobs, pipelines, apps — not just
  Delta tables).
- **Team league table** — benchmark the 50 teams on readiness, governance,
  quality/health, freshness, documentation, and cost. Who is strong vs a
  liability.
- **Cross-team fragmentation analysis** — elevate the per-scan canonical-entity /
  ontology pass to **portfolio scope** to expose duplicated/conflicting entities
  ("customer", "well", "production_volume" built N ways) and redundant data
  products across teams. This is the #1 CDO finding.
- **Federated, industry-mapped opportunities** — run data-gap + use-case
  discovery across the **combined** estate so cross-team, high-value NOC use cases
  (which need data spanning multiple teams) surface as a headline.
- **Org operating-model uplift plan** — see §5.5.

### 5.4 Consultant-grade insight layer (applies at every altitude)

Add an estate-level synthesis pass modeled on the Demo Research Engine
(`lib/demo/research-engine/`) and Business Value engine
(`lib/pipeline/steps/business-value-analysis.ts`):

- **Evidence model** — every assertion tiered `sourced` / `benchmark` /
  `inferred`. No naked claims.
- **Executive brief** — Situation → Complication → Resolution. "State of the
  nation" in crisp sections: estate shape, strengths, critical risks, quick
  wins, strategic recommendations.
- **Value-at-risk / opportunity sizing** — reuse
  `lib/engines/data-gap-analysis/economic-value.ts`; wire an **estate-level
  data-gap analysis** (schema already supports `ForgeDataGapAnalysis.scanId`; add
  the missing API route under `app/api/environment/...` and UI).
- **Cost dimension** — wire `lib/domain/cost-modeling.ts` / consumption so uplift
  and risk are expressed in dollars (optimize/vacuum debt → cost).
- **WAF posture** — stitch `lib/engines/waf-assessment` into the estate's
  quality/governance scorecard so "quality" includes security/reliability/cost.
- Persist synthesis deterministically; resilient passes (graceful skip +
  `passResultsJson`); never block a scan on a synthesis failure.

### 5.5 Engines become next-best-actions (the connective tissue)

Every finding carries a Forge action that resolves it. Re-home the engines:

| Finding | Action (existing engine) |
|---|---|
| Opportunity / outcome-map gap | **Opportunities** = discovery pipeline, invoked with full estate context; "auto-build SQL" becomes "activate this opportunity" |
| Documentation gap | **Comment Engine** |
| Query-ready domain | **Genie** space stand-up |
| Coverage / data gap | **Data-Gap** remediation + value-at-risk |
| Well-architected gap | **WAF Assessment** |
| Value quantification / roadmap | **Business Value** engine |

Discovery is no longer a front door; it is the grounded payoff. Keep a power-user
path to run engines directly, but they are not the hero.

### 5.6 UX / surfaces

Rebuild `app/environment/**` and `components/environment/**` into a cohesive
diagnostic. The spine is **Portfolio → Estate → Domain → Data Product → Table →
Column**. Every surface needs loading / empty / error states (rule 00) and one
visually-dominant primary CTA (rule 02/06). Modern shadcn/ui + Tailwind, real
charts (check repo for the charting lib in use), generous whitespace — it must
read like a McKinsey/BCG data diagnostic rendered as a live app, not a DB admin
tool.

Required surfaces:
1. **Portfolio / State of the Nation (new landing for CDO role)** — enterprise
   scorecard, team league table, cross-team fragmentation, federated
   opportunities, org uplift plan, provenance of which teams/workspaces compose
   it.
2. **Estate State of the Nation** — readiness scorecard with sub-scores
   (governance, quality/health, freshness, documentation, analytics maturity,
   cost), evidence-backed exec brief, top-3 strengths/risks/quick-wins (each
   click-through to evidence), visual analytics (domain maturity quadrant/heatmap,
   tier/freshness/health distributions, coverage gauges) — **no badge integers,
   no fake/zeroed inputs**.
3. **Domain explorer** — domains as first-class cards (maturity, counts, health,
   PII, ownership) drilling into data products and tables.
4. **Data products view** — surface Pass-7 data products as a real panel
   (today Excel-only): product → tables → consumers → quality → readiness.
5. **Lineage map** — a dedicated beautiful lineage/flow view (beyond the FK ERD):
   domain-level and table-level, upstream/downstream, with **freshness
   propagation** (stale upstream highlighted). Upgrade `erd-viewer.tsx`.
6. **Quality & freshness** — health (10 rules), freshness, optimize/vacuum debt
   as interactive, sortable, drill-down analytics — not a flat 100-row grid.
7. **Governance** — fix the mislabeled tab: real `GovernanceGap` insights +
   corrected score, per-domain posture, PII coverage, ownership gaps.
8. **Asset drill-down** — promote `app/environment/table/[fqn]/page.tsx` to a
   first-class, linked destination (currently orphaned); rich schema, lineage,
   history/health, freshness, insights, description, related opportunities.
9. **Sequenced-run management** — add/reorder/remove scopes, start/pause/cancel/
   resume, live per-scope progress (reuse `scan-progress.ts` + `ScanProgressCard`).

---

## 6. Work Plan (suggested sequencing)

1. **Plan doc** (first deliverable) — read cited files; resolve §11 decisions;
   define data model, federation approach, API surface, component tree, security
   model for the org-admin role, and migration plan.
2. **Tier 1 data model + migration** — scopes-on-scan; migrate sequencing off
   `estate-program.ts`; persist the world model; forward-only migration;
   `npx prisma generate`.
3. **Fix correctness bugs** (§4).
4. **Consultant synthesis layer** (§5.4) — evidence, exec brief, estate data-gap
   + value-at-risk + cost + WAF posture; persist.
5. **Tier 2 federation** (§5.2) — the chosen ingestion path + provenance.
6. **Tier 3 portfolio** (§5.3) — org-admin role, enterprise inventory, league
   table, cross-team fragmentation, federated opportunities, org uplift plan.
7. **Engines-as-actions** (§5.5) — re-home discovery as "Opportunities" grounded
   in estate context; wire action CTAs from findings.
8. **UX rebuild** (§5.6) surface by surface — Portfolio + Estate landings first.
9. **API consolidation** — collapse `/api/estate-programs/**` into scan routes;
   add estate data-gap route; keep aggregate/trends/table/erd/export; maintain
   `requireUser` + scoping on every route.
10. **Exports** — keep Excel + PDF board pack working against the new model;
    align to synthesis output; add a portfolio board pack.
11. **i18n** — all new strings in `messages/{en,pt-BR,es}.json`.
12. **Tests** (§9). **Docs** — update `AGENTS.md` + `docs/estate-analysis.md`.

---

## 7. Constraints & Guardrails (from AGENTS.md — must follow)

- **No raw SQL in components** — SQL in `lib/queries/**`; identifiers via
  `validateFqn()` / `validateIdentifier()`; literals via `escapeComment()`.
- **No hardcoded credentials / warehouse IDs** — Databricks Apps env vars only.
- **Privacy:** metadata only (schemas, names, history, tags) — never row-level
  data, including across federation.
- **User isolation is mandatory by default.** Every list/read route resolves
  `requireUser` and scopes by `ownerEmail` ∪ `listAccessibleIds`. Use
  `loadScanOrRespond` guards. Background jobs capture `ownerEmail` + `oboToken`
  in request context and thread them through. **The portfolio/org-admin view is
  the only exception** — it must be an explicit, feature-flagged, activity-logged
  role with a documented security model, never an ambient bypass.
- **OBO tokens** for user-scoped Databricks/Genie calls; never the SP.
- **Loading / empty / error** states everywhere; dominant primary CTA per page.
- **Integration checklist** (AGENTS.md): factory reset (`lib/lakebase/reset.ts`),
  activity logging (`lib/lakebase/activity-log.ts`), navigation, AGENTS.md docs,
  Prisma indexes + `ownerEmail`, SQL-injection protection, component reuse
  (`CatalogBrowser`, `SemanticSearchInput`, `stat-card.tsx`), isolation,
  embeddings scope (`lib/embeddings/kind-scope.ts`).
- **Quotas:** sequenced/federated scans spawn background jobs → respect
  `FORGE_MAX_ACTIVE_SCANS_PER_USER` via `lib/quotas.ts`.
- Keep discovery integration intact: `sourceScanId` reconstitution
  (`scan-reconstitution.ts`), `getLatestScanIdForRun()`.

---

## 8. Acceptance Criteria

### The Petronas executive test
- [ ] **What I have:** a Portfolio view aggregates across teams/workspaces
      (federation), with workspace/team provenance and a workload inventory
      (dashboards, Genie, models, jobs, pipelines, apps), not just tables.
- [ ] **Quality gaps:** a team league table benchmarks the 50 teams, and a
      cross-team fragmentation analysis exposes duplicated/conflicting entities
      and redundant products; WAF + cost posture included.
- [ ] **Uplift plan:** an org operating-model plan with owners, phasing, and
      dollars — not just per-table fixes.
- [ ] **Opportunities:** federated, industry-mapped (NOC/energy) use-case
      discovery is a headline output, including cross-team opportunities.

### The platform reframe
- [ ] State of the Nation is the new default landing; discovery is reachable as
      "Opportunities" *from* the estate, grounded in estate context.
- [ ] One persistent world model is produced by the scan and consumed by other
      engines (no cold re-scans); acting on the estate updates the model.
- [ ] Re-scan tracks drift and surfaces new risks/opportunities over time.
- [ ] Every State-of-the-Nation finding carries a Forge action that resolves it.

### Estate quality
- [ ] No "Estate Programs" in UI/nav; any scan supports an ordered, rolled-up
      sequenced run with pause/cancel/resume and live progress.
- [ ] Drill-down Portfolio → Estate → Domain → Data Product → Table → Column;
      every table reference links to the first-class table detail page.
- [ ] Dedicated lineage map (beyond FK ERD) with freshness propagation.
- [ ] Freshness + quality/health as interactive analytics; governance tab shows
      real gaps + corrected score; data products + analytics maturity surfaced in
      UI (not just Excel); no fake/zeroed inputs.
- [ ] Evidence-tiered (`sourced`/`benchmark`/`inferred`) executive brief.

### Engineering
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass. Unit tests for:
      synthesis/scoring logic, scopes/sequencing state machine, federation
      import/aggregation, cross-team entity resolution, new row-to-type mappers,
      new Zod schemas.
- [ ] All new strings in `en`, `pt-BR`, `es`.
- [ ] `AGENTS.md` and `docs/estate-analysis.md` updated.

---

## 9. Definition of Done

Forge presents as a **Data Estate Intelligence platform**: a CDO lands on a
federated State of the Nation across all teams, sees clearly what exists, where
the quality gaps and fragmentation are, a costed org uplift plan, and a set of
industry-aligned opportunities — then drills into any team, domain, product, or
table, and resolves findings with one-click Forge actions grounded in a single
living world model that gets smarter and remembers over time. Shipped behind the
isolation/quota model (with a deliberate, audited org-admin exception), fully
typed, tested, translated, and documented.

---

## 10. Reusable Forge primitives to build on (don't reinvent)

`buildSchemaContext()` (world model) · `runIntelligenceLayer` + `runEstateOntology`
(insights) · `runProgramSequence` (sequencing mechanics) · `getAggregateEstateView`
(roll-up) · data-gap economic-value · industry Master Repos + `industry-outcomes-server`
· health-score 10 rules · `walkLineage` + ERD builder · WAF engine · cost-modeling
· Business Value + Demo Research consultant patterns (evidence model) · trends
infra (drift) · `CatalogBrowser` / `SemanticSearchInput` / `stat-card` (UI).

---

## 11. Open Decisions for the Plan to Resolve

1. **Federation approach** — (a) hub-and-spoke export/import, (b) system-tables /
   UC federation / Delta Sharing, or (c) a `databricks` connector. Trade-offs,
   scale, governance, and which to build first.
2. **Data-model approach for scopes** — repurpose `ForgeEstateProgram` as an
   internal non-surfaced "scan group," or introduce `ForgeEstateScanScope` as a
   child of `ForgeEnvironmentScan`. Pick the lower-risk migration.
3. **Org-admin / portfolio security model** — how the cross-owner exception is
   granted, flagged, audited, and scoped (e.g. to a tenant/org).
4. **Workload inventory breadth** — which asset types to inventory in v1
   (dashboards, Genie, models, jobs, pipelines, apps) given API/scope limits.
5. **Cross-team entity resolution method** — embeddings-based vs ontology-merge
   vs name-normalisation, and where it runs (portfolio synthesis pass).
6. **Naming / IA** — final labels: "Estate" / "Intelligence" for the spine,
   "Opportunities" for discovery, "Actions" vocabulary for engines.
7. **Phasing** — what ships in v1 vs later (e.g. single-estate consultant UX +
   sequenced runs first; federation + portfolio second), without painting the
   data model into a corner.
