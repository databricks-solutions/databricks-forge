# Release Notes -- 2026-05-02

**Databricks Forge v0.40.0 → v1.0.0**

> **BREAKING -- DATA WIPE REQUIRED.** This release introduces true per-user
> isolation across the entire system. The schema migration adds a NOT NULL
> `owner_email` column to every root table, so all existing rows must be
> wiped before deploy. There is no in-place upgrade path. Run the factory
> reset (Settings -> Factory Reset, or the `deleteAllData()` startup hook)
> before flipping `FORGE_USER_ISOLATION=true`. Customers should export any
> wanted artefacts (Excel/PDF/PPTX exports, deployed Genie spaces are kept
> in Databricks and survive the wipe) prior to upgrading.

---

## v1.0.0 -- User Isolation & Team-Shared Refactor

### New Features

#### Per-user isolation across every surface
Forge moves from a single-tenant-shared Lakebase model to true per-user
isolation. Every root entity (`ForgeRun`, `ForgeEnvironmentScan`,
`ForgeGenieSpace`, `ForgeMetadataGenieSpace`, `ForgeSpaceBenchmarkRun`,
`ForgeSpaceHealthScore`, `ForgeDemoSession`, `ForgeCommentJob`,
`ForgeConnection`, `ForgeFabricScan`, `ForgeFabricMigration`,
`ForgeStrategyDocument`, `ForgeDocument`, `ForgeQualityMetric`) carries an
`ownerEmail` column. List, detail, update, delete, and export paths are
scoped through a single visibility rule:

```
WHERE owner_email = $user
   OR id IN (SELECT resource_id FROM forge_resource_acl
             WHERE resource_type = $type AND viewer_email = $user)
```

Outcome maps, benchmarks, prompt templates, and metadata cache stay global
by design.

#### Team-shared sharing model
A new `ForgeResourceAcl` table holds opt-in per-resource permissions
(`view` / `edit`). Owners share a run, scan, Genie space, demo session,
comment job, strategy document, connection, or document with another
teammate via a reusable `<ShareDialog>` component (shadcn). The dialog is
backed by `POST/DELETE/GET /api/share`.

| Permission | Read | Re-run | Edit | Delete | Re-share |
|---|---|---|---|---|---|
| `view` | yes | no | no | no | no |
| `edit` | yes | yes | yes | no | no |
| `owner` | yes | yes | yes | yes | yes |

Delete and re-share are owner-only by design.

#### Vector search isolation
`searchByVector()` and `retrieveContext()` now require `userEmail` and an
explicit kind-to-scope mapping (`lib/embeddings/kind-scope.ts`). Readers
resolve accessible parent ids via `listAccessibleIds(...)` and pass them
through; writers stay unchanged. RAG, semantic search, run suggestions,
and Ask Forge no longer leak embeddings across user boundaries.

#### Single mandatory auth seam
A new `lib/auth/route-user.ts` exports `requireUser()` and `ForgeUser`.
Next root middleware (`middleware.ts`) enforces 401 on every `/api/**` route
that lacks identity. Server Components call `requireUser()` directly at the
top of each render. Local dev supports a request-scoped `?as_user=` query
param (gated to `NODE_ENV !== "production"`) so a single tab can swap
identities without restarting the server.

#### Per-user fairness, quotas, and queueing
Per-user active-resource caps (configurable via env, default `1` for
pipelines / scans / demo engines, `2` for Genie deploys) are enforced at
every fire-and-forget kickoff. `ForgeRun.status` adds a new `queued`
state. When a user exceeds their cap, the run is enqueued instead of
rejected; a process-local scheduler (`lib/pipeline/scheduler.ts`) ticks
every 5s plus on-demand and atomically promotes the oldest queued run to
`pending` when free capacity opens up. Cancel-from-queued is supported.

The pool rate limiter (`lib/dbx/rate-limiter.ts`) now keeps a per-user
inflight tally per endpoint; the foundation for max-min fair-share is in
place. `ForgeUsage` records per-user daily counters (runs, LLM calls,
embed tokens) for future chargeback.

#### Queue & load visibility (Phase 5c)
- A new `<SystemLoadBanner />` (visible only when the system is busy) reads
  `GET /api/system-load` every ~8s and surfaces total active runs,
  per-endpoint LLM in-flight/queued counts, and 429 throttle states.
  Anonymous -- never exposes other users' identities.
- The runs list and run detail page show a `Queued` badge with hover
  position and a cancel-from-queue button.
- Activity log captures `pipeline_queued`, `pipeline_promoted`, and
  `endpoint_throttled` events.

### Improvements

- **Owner badges + "My / Shared" filters** -- every list view shows a
  small owner chip and a `Shared` icon when the current viewer is not the
  owner. Run, scan, Genie space, demo, and comment-job lists ship with a
  `My / Shared with me / All visible` selector.
- **Background job context** -- every fire-and-forget engine entrypoint
  now requires a `user: ForgeUser` field. The OBO token is captured at the
  request boundary and threaded through the entire async closure
  (mandatory for the Genie Conversation API; rule generalised to all
  fire-and-forget routes -- see `.cursor/rules/genie-obo-auth.mdc`).
- **`ForgeAssistantLog.userId` is now required** -- the feedback endpoint
  validates ownership before recording thumbs up/down.
- **Activity log scoped to caller** -- `getRecentActivity()` filters by
  `userEmail`; the per-user feed shows their own queue events and shares.
- **Stats are per-user** -- the dashboard and `/api/stats` count only the
  caller's resources.
- **`FORGE_USER_ISOLATION` flag** -- a new env-var feature flag controls
  the visibility of the sharing dialog and per-user quota enforcement.
  Data-layer filtering by `ownerEmail` is unconditional and not gated by
  the flag.
- **Factory reset coverage** -- `deleteAllData()` now wipes
  `ForgeFabricMigration`, `ForgeConnection`, `ForgeQualityMetric`,
  `ForgeSpaceBenchmarkRun`, `ForgeSpaceHealthScore`,
  `ForgeHealthCheckConfig`, `ForgeResourceAcl`, and `ForgeUsage` in
  addition to the existing tables.

### Breaking Changes

- **Schema migration is forward-only.** `owner_email` is `NOT NULL` on
  every root table. The migration runs on first boot post-deploy via
  `ensureMigrated()` and assumes the database has been wiped.
  `FORGE_USER_ISOLATION=false` does **not** restore pre-isolation
  behaviour because the data layer always filters by `ownerEmail`. Real
  rollback requires a Lakebase point-in-time restore.
- **Local dev requires `FORGE_LOCAL_USER_EMAIL`.** `.deploy_local.sh`
  sets it from `$USER_EMAIL` automatically; manual local runs must export
  the variable themselves.
- **Direct-ID API access checks ownership.** `getRunById`, update, delete,
  export, and per-resource action routes return 403 for non-owners
  (resolved via `lib/auth/route-guards.ts`).
- **Wipe does not delete external Databricks resources.** Demo Mode UC
  schemas and deployed Genie spaces are not Lakebase rows. Demo sessions
  are iterated through `cleanupDemoSession()` before wipe; Genie spaces
  remain in Databricks and re-attach on next sync.

### New Deploy Flags

```bash
./deploy.sh --disable-user-isolation                        # Run with isolation flag off (data layer still scopes)
./deploy.sh --max-pipeline-runs-per-user 2                  # Default 1
./deploy.sh --max-scans-per-user 2                          # Default 1
./deploy.sh --max-genie-deploys-per-user 4                  # Default 2
./deploy.sh --max-demo-engines-per-user 2                   # Default 1
```

### New Tables / Columns

- `forge_resource_acl` -- per-resource sharing permissions
- `forge_usage` -- per-user daily counters
- `owner_email` on every root table
- `queued` value added to the `ForgeRun.status` value set

### New Files

- `lib/auth/route-user.ts`, `lib/auth/route-guards.ts`
- `lib/lakebase/acl.ts`, `lib/lakebase/usage.ts`
- `lib/embeddings/kind-scope.ts`
- `lib/pipeline/scheduler.ts`
- `lib/dbx/system-load.ts`
- `lib/config/isolation-flag.ts`
- `lib/quotas.ts`
- `app/api/share/route.ts`
- `app/api/system-load/route.ts`
- `app/api/me/route.ts`
- `components/share/share-dialog.tsx`
- `components/system-load-banner.tsx`
- `lib/hooks/use-current-user.ts`
- `middleware.ts`

### Test Coverage

- 919 tests passing across unit + integration suites.
- New: `__tests__/auth/require-user.test.ts`,
  `__tests__/lakebase/acl.test.ts`,
  `__tests__/embeddings/kind-scope.test.ts`,
  `__tests__/rate-limiter/fair-share.test.ts`,
  `__tests__/pipeline/scheduler.test.ts`.

---

## All Commits

| Hash | Summary |
|---|---|
| (this release) | feat: user isolation and team-shared refactor (Phases 1-8) |
