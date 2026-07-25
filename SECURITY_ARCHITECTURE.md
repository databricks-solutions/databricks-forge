# Security Architecture -- Databricks Forge

> This document describes the security architecture, data flows, threat
> mitigations, and compliance posture of Databricks Forge. It is
> intended for security reviewers, architects, and compliance teams
> evaluating the application prior to deployment.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Deployment Model](#2-deployment-model)
3. [Authentication and Authorization](#3-authentication-and-authorization)
4. [Network Architecture](#4-network-architecture)
5. [Data Classification and Flow](#5-data-classification-and-flow)
6. [LLM Security (Prompt Injection and AI Safety)](#6-llm-security-prompt-injection-and-ai-safety)
7. [Input Validation and Injection Prevention](#7-input-validation-and-injection-prevention)
8. [Secret Management](#8-secret-management)
9. [HTTP Security Headers](#9-http-security-headers)
10. [Error Handling and Information Leakage](#10-error-handling-and-information-leakage)
11. [Logging and Auditability](#11-logging-and-auditability)
12. [Resilience and Timeout Protection](#12-resilience-and-timeout-protection)
13. [Container and Build Security](#13-container-and-build-security)
14. [API Surface and Threat Model](#14-api-surface-and-threat-model)
15. [Data Privacy and GDPR Considerations](#15-data-privacy-and-gdpr-considerations)
16. [Known Limitations and Recommendations](#16-known-limitations-and-recommendations)

---

## 1. Application Overview

Databricks Forge is a web application that discovers data-driven
use cases from Unity Catalog metadata. Users configure a business context,
point at their Unity Catalog catalogs/schemas, and the application generates
scored, categorised use cases with optional SQL code.

**Key architectural principle:** The application reads **only metadata**
(table names, column names, data types, foreign keys) from Unity Catalog.
No row-level business data is accessed in the default configuration.
An optional "sample data" feature can be enabled per-run, which is
documented separately below.

```mermaid
graph LR
  subgraph browser [User Browser]
    UI[Next.js Frontend]
  end

  subgraph dbxApp [Databricks App Container]
    API[Next.js API Routes]
    Engine[Pipeline Engine]
  end

  subgraph dbxPlatform [Databricks Platform]
    Proxy[Apps Reverse Proxy]
    Warehouse[SQL Warehouse]
    ModelServing[Model Serving]
    Lakebase[Lakebase Postgres]
    UC[Unity Catalog]
    Workspace[Workspace API]
  end

  UI -->|HTTPS| Proxy
  Proxy -->|Auth headers| API
  API --> Engine
  Engine -->|SQL Statement API| Warehouse
  Warehouse -->|information_schema| UC
  Engine -->|Chat Completions API| ModelServing
  Engine -->|Prisma| Lakebase
  Engine -->|Notebook export| Workspace
```

---

## 2. Deployment Model

The application is designed exclusively for deployment as a **Databricks App**,
running inside the customer's Databricks workspace boundary.

```mermaid
graph TB
  subgraph customerVPC [Customer VPC / Network Boundary]
    subgraph dbxWorkspace [Databricks Workspace]
      direction TB
      AppsProxy[Apps Reverse Proxy<br>TLS termination + user auth]
      AppContainer[App Container<br>Node.js 18 Alpine]
      SQLWarehouse[SQL Warehouse]
      LakebaseDB[Lakebase PostgreSQL]
      ModelEndpoint[Model Serving Endpoint]
    end
  end

  Internet[User Browser] -->|HTTPS| AppsProxy
  AppsProxy -->|x-forwarded-access-token| AppContainer
  AppContainer -->|Statement Execution API| SQLWarehouse
  AppContainer -->|Prisma TCP| LakebaseDB
  AppContainer -->|Chat Completions API| ModelEndpoint
```

| Property | Value |
|----------|-------|
| **Runtime** | Node.js 18 (Alpine Linux) |
| **Framework** | Next.js 16 (standalone output) |
| **Orchestration** | Databricks Apps (managed container) |
| **Network egress** | None -- all APIs are workspace-internal |
| **Public internet access** | Not required by the application |
| **Scaling** | Single-instance (Databricks Apps default) |

### Resource Bindings (`app.yaml`)

```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse          # Bound SQL Warehouse resource
  - name: DATABRICKS_SERVING_ENDPOINT
    valueFrom: serving-endpoint       # Bound Model Serving endpoint
```

### User Authorization Scopes

The app uses on-behalf-of (OBO) user authorization for SQL queries and
(optionally) Genie Space management. Configure these scopes in the
Databricks App UI (**Configure** → **+Add Scope**):

| Scope | Purpose |
|-------|---------|
| `sql` | SQL Statement Execution API (metadata queries, generated SQL, health check) |
| `catalog.tables:read` | Read tables in Unity Catalog |
| `catalog.schemas:read` | Read schemas in Unity Catalog |
| `catalog.catalogs:read` | Read catalogs in Unity Catalog |
| `files.files` | Manage files and directories (notebook export) |
| `dashboards.genie` | Manage Genie Spaces (create, update, trash) |
| `iam.access-control:read` | (default -- auto-included) Access control resolution |
| `iam.current-user:read` | (default -- auto-included) User identity from proxy headers |

Model Serving and Workspace APIs use app authorization (service principal).
Genie Space management defaults to user OBO auth (so the user's UC permissions
apply to referenced tables) but can be switched to service principal in
**Settings > Genie Engine > Deploy Authentication**.

The `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, and `DATABRICKS_CLIENT_SECRET`
are automatically injected by the Databricks Apps runtime. Runtime Lakebase
access defaults to native Postgres password auth against the pooler endpoint
(`LAKEBASE_AUTH_MODE=native_password`), with startup-generated endpoint metadata
(`LAKEBASE_ENDPOINT_NAME`, `LAKEBASE_POOLER_HOST`, `LAKEBASE_USERNAME`) from
`scripts/provision-lakebase.mjs`. OAuth runtime mode remains available as an
explicit deploy override.
No credentials are hardcoded or bundled with the application image.

---

## 3. Authentication and Authorization

### Authentication Modes (Priority Order)

```mermaid
flowchart TD
  A[Incoming Request] --> B{x-forwarded-access-token<br>header present?}
  B -->|Yes| C[User Authorization<br>On-behalf-of-user OAuth]
  B -->|No| D{DATABRICKS_TOKEN<br>env var set?}
  D -->|Yes| E[PAT Authentication<br>Local development only]
  D -->|No| F{CLIENT_ID +<br>CLIENT_SECRET set?}
  F -->|Yes| G[OAuth M2M<br>Service Principal]
  F -->|No| H[Error: No credentials]
```

| Mode | When Used | UC Permissions |
|------|-----------|----------------|
| **User authorization** | Databricks App with user-auth scopes | Follow the logged-in user |
| **PAT** | Local development (`DATABRICKS_TOKEN`) | Follow the token owner |
| **OAuth M2M** | Service principal fallback / background tasks | Follow the service principal |

### User Identity Resolution

| Header | Purpose |
|--------|---------|
| `x-forwarded-access-token` | User's OAuth access token (injected by Apps proxy) |
| `x-forwarded-email` | User's email address |
| `x-forwarded-preferred-username` | Fallback username |

### Authorization Model

The application enforces **per-user isolation at the application layer**
(team-shared opt-in sharing) on top of the Databricks platform's catalog and
warehouse permissions.

- **Unity Catalog permissions**: Metadata queries run as the authenticated user
  (or service principal). The user can only see catalogs, schemas, and tables
  they have `USE` or `SELECT` permissions on.
- **SQL Warehouse access**: The user must have `CAN USE` on the bound SQL Warehouse.
- **Workspace access**: Notebook export uses the logged-in user's OBO token
  (`getHeaders` with `files.files` scope) so notebooks are created under the
  user's identity and ownership. Falls back to service principal when no
  request context is available.
- **Model Serving**: LLM inference uses service principal credentials
  (`getAppHeaders`) because these operations are performed by the app.
- **Genie Space management**: Defaults to user OBO auth (`getHeaders` with
  `dashboards.genie` scope) so spaces are created under the user's identity
  and inherit their UC table permissions. Can be switched to service principal
  in Settings. The auth mode used to create each space is persisted and reused
  for subsequent updates and deletions.
- **Lakebase (per-user isolation)**: Every root table (`ForgeRun`,
  `ForgeEnvironmentScan`, `ForgeGenieSpace`, `ForgeMetadataGenieSpace`,
  `ForgeSpaceBenchmarkRun`, `ForgeSpaceHealthScore`, `ForgeDemoSession`,
  `ForgeCommentJob`, `ForgeConnection`, `ForgeFabricScan`,
  `ForgeFabricMigration`, `ForgeStrategyDocument`, `ForgeDocument`,
  `ForgeQualityMetric`) carries a NOT NULL `owner_email` column. List, detail,
  update, delete, and export paths apply a single visibility rule:

  ```sql
  WHERE owner_email = $user
     OR id IN (SELECT resource_id FROM forge_resource_acl
               WHERE resource_type = $type AND viewer_email = $user)
  ```

  Owners can opt-in share resources via `ForgeResourceAcl` with `view` or
  `edit` permissions (delete and re-share remain owner-only). Outcome maps,
  benchmarks, prompt templates, and metadata cache stay global by design.

- **Vector search**: `forge_embeddings` is filtered through accessible parent
  ids (run/scan/source) at query time -- callers pass `userEmail` and the
  reader resolves accessible ids via `lib/lakebase/acl.ts`. Catalog kinds
  (`outcome_map`, `benchmark_context`, skills, industry KPIs) remain global.

- **Auth seam**: `lib/auth/route-user.ts` exposes `requireUser()` and
  `getUserOrNull()`. Next.js 16's root proxy (`proxy.ts`, the renamed
  middleware convention) enforces 401 on every `/api/**` route that lacks
  identity. Server Components call
  `requireUser()` directly. Local dev supports a `?as_user=` query param
  override gated to `NODE_ENV !== "production"` for end-to-end isolation
  testing.

- **Per-user fairness & quotas**: Per-user active-resource caps (configurable
  via env, default 1 for pipelines/scans/demo engines, 2 for Genie deploys)
  are enforced at every fire-and-forget kickoff. Pipelines exceeding the cap
  are queued (`status='queued'`) and promoted by a process-local scheduler
  (`lib/pipeline/scheduler.ts`) when capacity opens up. The pool rate
  limiter tracks per-user inflight calls per endpoint to support fair-share
  scheduling.

- **`FORGE_USER_ISOLATION` feature flag**: gates the UI sharing dialog and
  per-user quota enforcement. Data-layer filtering by `owner_email` is
  unconditional and not affected by the flag.

### Session Management

The application is **stateless**. There are no sessions, cookies, or
server-side session stores. Each request is authenticated independently
via the forwarded token or environment credentials.

### OAuth Token Caching

Service principal OAuth tokens are cached in-memory with a 60-second
expiry buffer. The cache is process-local and not shared across instances.

---

## 4. Network Architecture

### External Connections

| Destination | Protocol | Port | Purpose |
|-------------|----------|------|---------|
| SQL Warehouse | HTTPS | 443 | Metadata queries, generated SQL execution |
| Model Serving | HTTPS | 443 | LLM inference (chat completions API) |
| Lakebase | TLS/TCP | 5432 | Pipeline run persistence (Prisma ORM) |
| Workspace API | HTTPS | 443 | Notebook export only |
| OIDC endpoint | HTTPS | 443 | OAuth M2M token exchange |

All connections remain **within the Databricks workspace boundary**. The
application makes zero calls to public internet endpoints.

### TLS

- All Databricks API calls use HTTPS (TLS 1.2+).
- TLS termination for inbound traffic is handled by the Databricks Apps
  reverse proxy.
- Lakebase connections use TLS via runtime-generated Postgres URLs.

---

## 5. Data Classification and Flow

### Data Classification

| Data Category | Classification | Examples |
|---------------|---------------|----------|
| **User configuration** | Internal | Business name, strategic goals, priorities |
| **UC metadata** | Internal / Confidential | Table names, column names, data types, FKs |
| **LLM-generated content** | Internal | Business context, use cases, SQL code |
| **Sample row data** (opt-in) | Confidential / Restricted | Actual table values (truncated to 60 chars) |

### Data Flow Diagram

```mermaid
flowchart LR
  subgraph inputs [Inputs]
    UserConfig[User Config<br>business name, goals, priorities]
    UCMetadata[Unity Catalog<br>information_schema]
    SampleData[Sample Rows<br>SELECT * LIMIT N<br>opt-in only]
  end

  subgraph processing [Processing - Pipeline Engine]
    Step1[Step 1: Business Context<br>LLM generates context]
    Step3[Step 3: Table Filtering<br>LLM classifies tables]
    Step4[Step 4: Use Case Gen<br>LLM generates use cases]
    Step5[Step 5: Domain Clustering<br>LLM assigns domains]
    Step6[Step 6: Scoring<br>LLM scores + dedup]
    Step7[Step 7: SQL Generation<br>LLM writes SQL]
  end

  subgraph persistence [Persistence]
    Lakebase2[Lakebase<br>runs, use cases, exports]
  end

  subgraph outputs [Outputs]
    Excel[Excel export]
    PDF[PDF export]
    PPTX[PPTX export]
    Notebooks[SQL Notebooks<br>via Workspace API]
  end

  UserConfig --> Step1
  UCMetadata --> Step3
  UCMetadata --> Step4
  SampleData -.->|optional| Step7
  Step1 --> Step3 --> Step4 --> Step5 --> Step6 --> Step7
  Step7 --> Lakebase2
  Lakebase2 --> Excel
  Lakebase2 --> PDF
  Lakebase2 --> PPTX
  Lakebase2 --> Notebooks
```

### What Data is Sent to the LLM?

| Pipeline Step | Data Sent | Contains Row Data? |
|---------------|-----------|-------------------|
| Business Context | Business name, industry | No |
| Table Filtering | Table FQNs, types, comments + business context | No |
| Use Case Generation | Schema markdown (table/column names, types) + FK relationships | No |
| Domain Clustering | Use case names, statements (LLM-generated) | No |
| Scoring | Use case summaries (LLM-generated) | No |
| SQL Generation | Schema markdown + FK relationships + **sample rows (if enabled)** | **Only if opt-in** |
| SQL Fix | Original SQL + error message + schema | No |

### Sample Data Feature (Opt-in)

When `sampleRowsPerTable > 0` (configurable in Settings, range 0-50):

- `SELECT * FROM <table> LIMIT N` is executed for each table referenced by a
  use case during SQL generation.
- Values are truncated to 60 characters.
- Sample data is formatted as markdown and injected into the SQL-generation
  prompt only.
- **Sample data is NOT persisted** -- it exists only in-memory during the
  generation step and is discarded after the LLM call.
- **Sample data is NOT exported** -- it does not appear in Excel, PDF, PPTX,
  or notebook outputs.

### Data Retention

| Data | Storage | Retention |
|------|---------|-----------|
| Pipeline runs | Lakebase (forge_runs) | Until user deletes via UI |
| Use cases | Lakebase (forge_use_cases) | Cascade-deleted with run |
| Export records | Lakebase (forge_exports) | Cascade-deleted with run |
| Exported files (Excel/PDF/PPTX) | In-memory only | Not persisted on disk |
| Exported notebooks | Databricks Workspace | Governed by Workspace retention |

---

## 6. LLM Security (Prompt Injection and AI Safety)

### LLM Execution Model

All LLM calls are executed via direct REST calls to the Databricks Model
Serving chat completions API (`/serving-endpoints/{endpoint}/invocations`).
The application does **not** call external LLM APIs (OpenAI, Anthropic, etc.)
directly. The model endpoint is workspace-internal. The SQL Warehouse is used
only for metadata queries and generated SQL execution -- not for LLM inference.

```mermaid
sequenceDiagram
  participant App as Pipeline Engine
  participant MS as Model Serving
  App->>MS: POST /serving-endpoints/{endpoint}/invocations
  Note right of App: Chat completions format (system + user messages)
  MS-->>App: JSON response with content + token usage
```

### Prompt Injection Mitigations

| Control | Implementation |
|---------|----------------|
| **Delimiter wrapping** | User-supplied text is wrapped in `---BEGIN USER DATA---` / `---END USER DATA---` markers before injection into prompts |
| **Marker stripping** | Existing delimiter markers in user input are stripped to prevent delimiter escape attacks |
| **User variable identification** | A whitelist (`USER_INPUT_VARIABLES`) identifies which template variables contain user input and require sanitisation |
| **System/user separation** | Prompts use chat completions format with separate system and user messages, providing structural isolation between instructions and user data |
| **JSON mode** | Most pipeline steps use `response_format: json_object` which constrains LLM output to valid JSON, reducing attack surface |
| **Output validation** | LLM JSON outputs are parsed and validated with Zod schemas before use; malformed items are dropped |
| **Structured output formats** | Prompts request specific JSON array output formats, reducing free-text attack surface |

### Honesty Score Monitoring

Each LLM response that includes an honesty check is scored (0.0-1.0). The
agent logs a warning when the score falls below 0.3, indicating the LLM may
be uncertain about output quality. This provides a signal for detecting
adversarial or low-quality responses.

### AI Model Governance

- The model endpoint is configured per-run (`aiModel` field).
- The endpoint must be a Databricks Model Serving endpoint accessible from
  the workspace.
- Model selection is restricted to endpoints the service principal or user
  has `CAN QUERY` permissions on.

---

## 7. Input Validation and Injection Prevention

### SQL Injection Prevention

```mermaid
flowchart LR
  UserInput[User Input<br>catalog/schema names] --> Validate{validateIdentifier<br>regex: a-zA-Z0-9_-}
  Validate -->|Pass| Interpolate[Safe SQL interpolation]
  Validate -->|Fail| Reject[400 Bad Request]
```

| Control | Detail |
|---------|--------|
| **Identifier validation** | All catalog/schema names pass through `validateIdentifier()` which enforces `/^[a-zA-Z0-9_\-]+$/` |
| **Length limits** | Identifiers capped at 255 characters |
| **UUID validation** | All `runId` parameters validated against UUID regex before database queries |
| **Zod schemas** | API request bodies validated with Zod: `CreateRunSchema` (field lengths, types, ranges), `MetadataQuerySchema` (enum types) |
| **Safe body parsing** | `safeParseBody()` wraps JSON parse + Zod validation, returning structured errors |

### Validation by Route

| Route | Validation Applied |
|-------|-------------------|
| `POST /api/runs` | `CreateRunSchema` (Zod), field length limits |
| `GET /api/runs` | `limit` (1-200), `offset` (>=0) |
| `GET /api/runs/[runId]` | `isValidUUID(runId)` |
| `DELETE /api/runs/[runId]` | `isValidUUID(runId)` |
| `POST /api/runs/[runId]/execute` | `isValidUUID(runId)` |
| `GET /api/metadata` | `validateIdentifier()` for catalog/schema |
| `GET /api/health` | No user input |

### LLM Output Validation

All LLM responses are validated before use:

| Output Type | Validation |
|-------------|------------|
| Business context JSON | `parseJSONResponse()` with try/catch fallback to defaults |
| Score items | `ScoreItemSchema` (Zod) -- validates no, priority_score, feasibility_score, impact_score, overall_score |
| Dedup items | `DedupItemSchema` (Zod) -- validates no, action, reason |
| Domain assignments | `DomainAssignmentSchema` (Zod) -- validates no, domain |
| Subdomain assignments | `SubdomainAssignmentSchema` (Zod) -- validates no, subdomain |
| Calibration items | `CalibrationItemSchema` (Zod) -- validates no, overall_score |
| Cross-domain dedup | `CrossDomainDedupItemSchema` (Zod) -- validates no, duplicate_of, reason |
| SQL output | Structural validation (keyword check, table reference check, column existence check) |
| CSV responses | Column count tolerance (+-2), try/catch with empty fallback |

Invalid items are logged and dropped; they do not crash the pipeline.

---

## 8. Secret Management

### Secrets Inventory

| Secret | Source | Scope |
|--------|--------|-------|
| `DATABRICKS_HOST` | Databricks Apps runtime | Platform-injected |
| `DATABRICKS_CLIENT_ID` | Databricks Apps runtime | Platform-injected |
| `DATABRICKS_CLIENT_SECRET` | Databricks Apps runtime | Platform-injected |
| `DATABRICKS_WAREHOUSE_ID` | `app.yaml` resource binding | Platform-injected |
| `LAKEBASE_ENDPOINT_NAME` | Auto-generated at startup | Lakebase endpoint resource name |
| `LAKEBASE_POOLER_HOST` | Auto-generated at startup | Lakebase runtime pooler host |
| `LAKEBASE_USERNAME` | Auto-generated at startup | Lakebase runtime username |
| `LAKEBASE_AUTH_MODE` | Deploy/startup configuration | Runtime DB auth mode |
| `LAKEBASE_NATIVE_USER` | Deploy/startup configuration | Native Postgres runtime role |
| `LAKEBASE_NATIVE_PASSWORD` | Deploy rotation or startup fallback | Native Postgres runtime password |
| `DATABASE_URL` | `.env.local` (local dev only) | Local fallback connection string |
| `DATABRICKS_TOKEN` | `.env.local` (local dev only) | Developer machine |

### Controls

| Control | Implementation |
|---------|----------------|
| **No hardcoded secrets** | All credentials from environment variables |
| **gitignore** | `.env*` files excluded (except `.env.local.example`) |
| **No secrets in Docker image** | Multi-stage build; env vars provided at runtime |
| **Token caching** | OAuth tokens cached in-memory with 60s expiry buffer; no disk persistence |
| **Secret rotation** | Native password rotation is controlled via `deploy.sh` flags (`--rotate-lakebase-native-password`) with explicit deploy audit trail; OAuth fallback mode remains available |

---

## 9. HTTP Security Headers

Applied to all routes via `next.config.ts`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer information |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable unnecessary browser APIs |
| `X-Powered-By` | (removed) | `poweredByHeader: false` hides server technology |

### Additional Next.js Defaults

- `reactStrictMode: true` -- enables strict React rendering checks
- `output: "standalone"` -- minimal production bundle

---

## 10. Error Handling and Information Leakage

### Error Boundaries

| Boundary | File | Behaviour |
|----------|------|-----------|
| Route error | `app/error.tsx` | Displays `error.message` + `error.digest` (opaque hash) |
| Global error | `app/global-error.tsx` | Displays `error.message` + `error.digest` |
| Not found | `app/not-found.tsx` | Generic 404 -- no sensitive information |

### API Error Responses

- API routes return generic error messages (e.g. "Failed to create run").
- Full error details are logged server-side via the structured logger.
- Stack traces are never included in HTTP responses.
- The health endpoint may expose database/warehouse error messages in the
  `checks.*.error` field (connection-level errors only).

### Production Considerations

In production (`NODE_ENV=production`):
- Next.js automatically sanitises error messages in error boundaries, replacing
  them with generic text and an opaque `digest` hash.
- Server-side logs use structured JSON format for log aggregation.

---

## 11. Logging and Auditability

### Structured Logging

```mermaid
flowchart LR
  subgraph logSources [Log Sources]
    AgentLog[AI Agent<br>promptKey, model, duration, honestyScore]
    PipelineLog[Pipeline Engine<br>step timing, runId]
    StepLog[Pipeline Steps<br>domain, useCaseCount]
  end

  subgraph logOutput [Output]
    DevFormat[Dev: Formatted text]
    ProdFormat[Prod: JSON to stdout]
  end

  AgentLog --> ProdFormat
  PipelineLog --> ProdFormat
  StepLog --> ProdFormat
  AgentLog --> DevFormat
  PipelineLog --> DevFormat
  StepLog --> DevFormat
```

| Field | Logged With |
|-------|------------|
| `runId` | All pipeline and engine logs |
| `promptKey` | Every LLM call |
| `promptVersion` | SHA-256 hash of the template used |
| `model` | Model endpoint name |
| `durationMs` | LLM call duration |
| `responseChars` | LLM response size |
| `honestyScore` | LLM self-assessment (0.0-1.0) |
| `temperature` | LLM temperature parameter |

### Run-Level Audit Trail

Each pipeline run stores:

| Field | Purpose |
|-------|---------|
| `appVersion` | Application version at time of execution |
| `promptVersions` | SHA-256 hash of every prompt template used |
| `stepLog[]` | Per-step timing: `startedAt`, `completedAt`, `durationMs`, `error` |
| `aiModel` | Model endpoint used |
| `config` | Full run configuration (business name, metadata path, options) |
| `createdAt` / `completedAt` | Timestamps |

This provides full reproducibility: given a run's `promptVersions` and
`appVersion`, you can reconstruct exactly which prompt text and application
code produced the results.

---

## 12. Resilience and Timeout Protection

### Fetch Timeouts

All external API calls use `AbortController`-based timeouts to prevent
indefinite hangs:

| Operation | Timeout |
|-----------|---------|
| OAuth token exchange | 15 seconds |
| SQL statement submission | 30 seconds |
| SQL statement polling | 15 seconds |
| SQL chunk fetching | 30 seconds |
| Workspace API calls | 30 seconds |

### Retry Policy

| Condition | Behaviour |
|-----------|-----------|
| 5xx errors | Retry with exponential backoff (2s, 4s, 8s, max 10s) |
| Timeout / network errors | Retry |
| 4xx errors | No retry (non-retryable) |
| `INSUFFICIENT_PERMISSIONS` | No retry |
| SQL syntax errors (`SQLSTATE: 42`) | No retry |
| Default max retries | 1 (configurable per call) |

### Pipeline Resilience

Each pipeline step has independent error handling:

| Step | Failure Behaviour |
|------|------------------|
| Business context | Falls back to default context |
| Table filtering | Fail-open: includes all tables |
| Use case generation | Failed batches skipped; successful batches kept |
| Domain clustering | Falls back to "General" domain |
| Scoring | Default scores (0.5) on failure |
| Cross-domain dedup | Skipped on failure (no removals) |
| SQL generation | Per-use-case: marks as "failed"; attempts fix via `USE_CASE_SQL_FIX_PROMPT` |

---

## 13. Container and Build Security

### Multi-Stage Docker Build

```dockerfile
# Stage 1: Build (builder) -- install deps, generate Prisma, build Next.js
FROM node:18-alpine AS builder

# Stage 2: Run (runner) -- minimal runtime with standalone output only
FROM node:18-alpine AS runner
ENV NODE_ENV=production
```

| Control | Detail |
|---------|--------|
| **Base image** | `node:18-alpine` (minimal attack surface) |
| **Multi-stage** | Build dependencies not included in runtime image |
| **No secrets in image** | All credentials provided at runtime via env vars |
| **Production mode** | `NODE_ENV=production` -- disables dev tooling |
| **Standalone output** | Only the minimum files needed to run are copied |
| **No root user** | Runs as default Node.js user in Alpine |

### Dependency Management

- Dependencies pinned via `package-lock.json` (`npm ci` for deterministic installs).
- No post-install scripts beyond Prisma client generation.

---

## 14. API Surface and Threat Model

### API Endpoints

```mermaid
flowchart TD
  subgraph public [Public API Surface]
    Health[GET /api/health]
    Runs[POST /api/runs]
    RunsList[GET /api/runs]
    RunDetail[GET /api/runs/:runId]
    RunDelete[DELETE /api/runs/:runId]
    RunExec[POST /api/runs/:runId/execute]
    Metadata[GET /api/metadata]
    Export[GET /api/export/:runId]
  end

  subgraph auth [Auth Layer]
    DatabricksProxy[Databricks Apps Proxy<br>SSO + token injection]
  end

  Browser[User Browser] -->|HTTPS| DatabricksProxy
  DatabricksProxy --> public
```

### Threat Model

| Threat | Mitigation | Residual Risk |
|--------|-----------|---------------|
| **Unauthenticated access** | Databricks Apps proxy requires SSO login | None when deployed as Databricks App |
| **SQL injection via catalog/schema** | `validateIdentifier()` with strict regex | Low |
| **Prompt injection via user input** | Delimiter wrapping + marker stripping | Medium -- LLMs are inherently susceptible |
| **Cross-site scripting (XSS)** | React auto-escaping + `X-Content-Type-Options: nosniff` | Low |
| **Clickjacking** | `X-Frame-Options: DENY` | None |
| **Denial of service** | Fetch timeouts + SQL Warehouse concurrency limits | Medium -- no app-level rate limiting |
| **Data exfiltration via LLM** | Only metadata sent; sample data opt-in; no PII by design | Low |
| **Insecure deserialization** | Zod validation on all API inputs | Low |
| **Broken access control** | UC permissions enforced by Databricks; per-user isolation enforced at app layer (`owner_email` + `forge_resource_acl`); middleware-enforced auth seam | Low |
| **Information leakage** | Error boundaries show opaque digests in production; health endpoint may expose connection errors | Low |
| **Supply chain** | Pinned deps via lockfile; Alpine base image | Low |

---

## 15. Data Privacy and GDPR Considerations

### Personal Data Handling

| Category | Handling |
|----------|---------|
| **User identity** | Email read from proxy headers; used only for notebook export path (`/Users/<email>/`). Not stored in Lakebase. |
| **Business data (row-level)** | Not accessed in default mode. When sampling is enabled, values are truncated, used transiently in-memory, and never persisted or exported. |
| **Metadata** | Table/column names may be considered business-confidential but are not personal data. |
| **LLM-generated content** | Contains no personal data; derived from metadata and business configuration. |

### Data Processing Principles

| Principle | Implementation |
|-----------|----------------|
| **Data minimisation** | Only metadata is read by default; sample data is opt-in with configurable limits (0-50 rows) |
| **Purpose limitation** | Data is used exclusively for use case discovery and SQL generation |
| **Storage limitation** | Runs can be deleted via UI; cascade deletes remove all associated data |
| **No external transfers** | All processing occurs within the Databricks workspace; no data leaves the customer's environment |
| **Right to erasure** | `DELETE /api/runs/:runId` removes all associated data |

### Data Residency

All data processing and storage occurs within the customer's Databricks
workspace. The application does not transmit data to any external service,
third-party API, or cross-region endpoint.

---

## 16. Known Limitations and Recommendations

### Resolved

| Area | Resolution |
|------|-----------|
| **CSP header** | `Content-Security-Policy` configured in `next.config.ts` (`default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`, etc.) |
| **HSTS header** | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` added to `next.config.ts` |
| **App-level rate limiting** | In-memory sliding-window limiter in `lib/rate-limit.ts`, activated via `proxy.ts` (LLM routes: 3k/min, general: 12k/min per client) |
| **Health endpoint exposure** | `/api/health` returns only `{ status, version, uptime, timestamp }` for unauthenticated callers; full diagnostics (checks, authRuntime, host) require auth headers |
| **Error message sanitisation** | `safeErrorMessage()` in `lib/error-utils.ts` returns generic message in production; applied to all API route error responses. Error boundaries rely on Next.js production sanitisation |
| **Prompt injection (Ask Forge)** | User question now wrapped in `---BEGIN USER QUESTION---` / `---END USER QUESTION---` delimiters with marker stripping in `lib/assistant/prompts.ts` |
| **Sample data audit logging** | `fetchSampleData()` logs structured audit entry with table FQNs, runId, userEmail, and step |
| **Dependency audits in CI** | `npm audit --audit-level=high` step added to `.github/workflows/ci.yml` |
| **Per-user isolation (full)** | Every root table has `owner_email` (NOT NULL); list, detail, update, delete, and export paths apply the visibility rule (`owner OR shared`); team-shared opt-in via `ForgeResourceAcl`; vector search filters by accessible parent ids; auth seam enforced via `proxy.ts` + `requireUser()`; Server Components call `requireUser()` directly. |
| **Per-user fairness** | Active-resource caps per user (`FORGE_MAX_ACTIVE_*_PER_USER`); pipeline runs queue when over cap; pool rate limiter tracks per-user inflight per endpoint; system-load banner surfaces aggregate load anonymously. |

### Current Limitations

| Area | Limitation | Risk Level |
|------|-----------|------------|
| **Group sharing** | Sharing is per-resource per-email only. Group/team sharing (`ForgeTeam`) is a documented follow-up. | Low |
| **Owner transfer / GDPR erasure** | Bulk owner transfer and right-to-erasure require manual SQL today. The schema supports both (cascading deletes are wired) but a single `lib/lakebase/erase-user.ts` orchestrator and admin UI is a follow-up. | Low |
| **Schema rollback** | The migration is forward-only (`owner_email` is NOT NULL). `FORGE_USER_ISOLATION=false` does not restore pre-isolation behaviour because the data layer always filters by `owner_email`. Real rollback requires a Lakebase point-in-time restore. | Medium (deploy-time only) |
| **Prompt injection** | Delimiter-based mitigation reduces but cannot eliminate risk (inherent LLM limitation) | Medium |
| **`unsafe-inline` in CSP** | `script-src 'self' 'unsafe-inline'` still required by Next.js; nonce-based CSP would be stronger | Low |

### Recommendations for Further Hardening

1. **Group / team sharing** -- add `ForgeTeam` + `ForgeTeamMember` and an
   ACL `viewerType: email | team` to grant access to a whole team in one
   row.
2. **Owner transfer & GDPR erasure** -- add a single
   `lib/lakebase/erase-user.ts` orchestrator and admin UI to bulk-transfer
   or delete a user's resources (the schema already supports cascading
   deletes via the `owner_email` column).
3. **SCIM email autocomplete** -- replace the free-text recipient input on
   the share dialog with SCIM directory autocomplete
   (`/api/2.0/preview/scim/v2/Users`).
4. **Notifications on share** -- in-app + email/Slack notification when a
   resource is shared with you; today the activity log records
   `resource_shared` / `resource_unshared` for future wiring.
5. **Nonce-based CSP** -- replace `'unsafe-inline'` with per-request nonces
   once Next.js supports it natively.
6. **Per-user LLM budget enforcement** -- `ForgeUsage` is read-only in
   v1.0.0; turn it into a hard cap once usage data is available.

---

## Appendix A: Environment Variables

| Variable | Required | Source | Description |
|----------|----------|--------|-------------|
| `DATABRICKS_HOST` | Yes | Platform | Workspace URL (e.g. `https://workspace.cloud.databricks.com`) |
| `DATABRICKS_WAREHOUSE_ID` | Yes | app.yaml | Bound SQL Warehouse ID |
| `LAKEBASE_ENDPOINT_NAME` | Auto | Startup script | Lakebase endpoint resource name used by `/api/2.0/postgres/credentials` |
| `LAKEBASE_POOLER_HOST` | Auto | Startup script | Pooler hostname for runtime queries |
| `LAKEBASE_USERNAME` | Auto | Startup script | Cached runtime username (service principal identity) |
| `DATABASE_URL` | Dev only | `.env.local` | Local development Lakebase PostgreSQL connection string |
| `DATABRICKS_CLIENT_ID` | Auto | Platform | Service principal client ID |
| `DATABRICKS_CLIENT_SECRET` | Auto | Platform | Service principal client secret |
| `DATABRICKS_TOKEN` | Dev only | `.env.local` | Personal access token for local development |
| `DATABRICKS_APP_PORT` | Optional | Platform | Listen port (default: 3000) |
| `LOG_LEVEL` | Optional | `.env` | Minimum log level: debug, info, warn, error |
| `NODE_ENV` | Auto | Dockerfile | `production` in deployed image |

## Appendix B: Compliance Mapping

| Control | OWASP Top 10 | SOC 2 | Implementation |
|---------|-------------|-------|----------------|
| Authentication | A07:2021 | CC6.1 | Databricks SSO via Apps proxy |
| Input validation | A03:2021 | CC6.1 | Zod schemas + regex validation |
| Injection prevention | A03:2021 | CC6.1 | `validateIdentifier()` + parameterised patterns |
| Security headers | A05:2021 | CC6.6 | X-Frame-Options, X-Content-Type-Options, etc. |
| Logging | A09:2021 | CC7.2 | Structured JSON logging with run correlation |
| Error handling | A04:2021 | CC7.3 | Error boundaries with opaque digests |
| Secrets management | A02:2021 | CC6.1 | Environment-only; no hardcoded credentials |
| Data minimisation | -- | CC6.5 | Metadata-only by default; row access opt-in |
