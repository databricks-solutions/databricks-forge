# ASK_FORGE.md -- Conversational Data Intelligence Assistant

> Complete specification of the Ask Forge feature: a conversational AI assistant
> that answers questions about the user's Unity Catalog data estate, proposes SQL,
> and enables one-click deployment of notebooks, dashboards, and Genie Spaces.

---

## Overview

Ask Forge is a RAG-powered conversational assistant embedded in Databricks Forge.
Users ask natural-language questions about their data estate and receive grounded
answers enriched with real metadata, executable SQL, lineage context, and
actionable deployment options. Every response cites its sources and is traceable
back to the vector store chunks that informed it.

### Key Capabilities

- Answer business and technical questions grounded in actual Unity Catalog metadata
- Propose SQL using only real table/column names from the user's estate
- Classify user intent to tailor response strategy and available actions
- Surface table health, lineage, PII, governance, and freshness alongside answers
- One-click actions: run SQL, deploy notebooks, create dashboards, launch Genie Spaces
- Dual-strategy context pipeline: direct Lakebase queries + vector semantic search
- Full interaction logging with thumbs up/down feedback for continuous improvement
- Keyboard shortcut (Cmd+J / Ctrl+J) for instant access from anywhere in the app

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  /ask-forge (Page → dynamic import, ssr: false)          │
│  ┌──────────────┐ ┌───────────────────────┐ ┌────────────────────────┐  │
│  │ Conversation  │ │    AskForgeChat        │ │  AskForgeContextPanel  │  │
│  │ History       │ │  • Message thread      │ │  • Referenced tables   │  │
│  │ (sidebar)     │ │  • SSE streaming       │ │  • Health / lineage    │  │
│  │  • Per-user   │ │  • Action cards        │ │  • Expandable sources  │  │
│  │  • Rename     │ │  • Source citations     │ │  • AI insight fallback │  │
│  │  • Delete     │ │  • Feedback buttons    │ │  • ERD viewer          │  │
│  │  • Date groups│ │  • react-markdown GFM  │ │  • "Ask about table"   │  │
│  └──────┬───────┘ └────────────┬───────────┘ └────────────────────────┘  │
│         │                      │                                         │
│   GET/POST /api/assistant/conversations    POST /api/assistant (SSE)     │
│         │                      │                                         │
│  ┌──────▼──────────────────────▼─────────┐                               │
│  │         Assistant Engine               │                               │
│  │  1. classifyIntent()                  │───► Fast model (JSON mode)     │
│  │  2. buildAssistantContext()           │───► Lakebase + pgvector RAG    │
│  │  3. buildAssistantMessages            │───► System + user prompts      │
│  │  4. chatCompletionStream()            │───► Premium model (streaming)  │
│  │  5. extractSqlBlocks()                │                                │
│  │  6. extractDashboardIntent            │                                │
│  │  7. buildActions()                    │                                │
│  │  8. createAssistantLog()              │───► Lakebase persistence       │
│  │  9. createConversation() (first msg)  │───► Lakebase persistence       │
│  └───────────────────────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Engine Pipeline

The assistant engine (`lib/assistant/engine.ts`) orchestrates a sequential
pipeline for every user question:

### Step 1: Intent Classification

**Module:** `lib/assistant/intent.ts`

Classifies the user's question into one of five intents using the fast serving
endpoint (low-latency model). The intent determines RAG scope, response
strategy, and available actions.

| Intent | Description | Example |
|-------------|------------------------------------------------|----------------------------------------|
| `business` | Business value, KPIs, metrics, analytics | "How can I calculate Customer Lifetime Value?" |
| `technical` | Data quality, health, maintenance, governance | "Which tables haven't run OPTIMIZE?" |
| `dashboard` | Visualisation, charts, trends, comparisons | "Show me revenue trends by region" |
| `navigation`| Finding specific entities (tables, use cases) | "Find customer tables" |
| `exploration`| Open-ended investigation of the estate | "What PII risks exist in Finance?" |

**Classification flow:**

1. Send the question to `getFastServingEndpoint()` with the intent system prompt
2. Parse the JSON response: `{ intent, confidence, reasoning }`
3. Validate the intent is one of the five allowed values
4. On failure (LLM error, invalid JSON, endpoint unavailable), fall back to
   `heuristicClassify()` which uses regex patterns:
   - Dashboard patterns: `show me`, `chart`, `trend`, `visualize`, `compare...by`
   - Technical patterns: `optimize`, `vacuum`, `health`, `pii`, `governance`
   - Navigation patterns: `find`, `where is`, `show the`, `navigate`
   - Business patterns: `calculate`, `kpi`, `metric`, `revenue`, `forecast`
   - Default: `exploration` at 0.5 confidence

### Step 2: Context Building

**Module:** `lib/assistant/context-builder.ts`

Builds a rich context payload using a dual-strategy pipeline. Both strategies
run independently and their results are merged before LLM injection.

#### Strategy 1: Direct Lakebase Queries (always available)

Fetches structured context directly from the database, independent of the
embedding/vector search system:

| Section | Source Table | Content |
|---------|-------------|---------|
| Business Context | `ForgeRun` (latest completed) | Organisation name, business context, priorities, strategic goals, domains |
| Estate Summary | `ForgeEnvironmentScan` (latest) | Table count, domain count, PII table count, avg governance score, lineage edges, data product count |
| Deployed Assets | `ForgeDashboard` + `ForgeGenieSpace` | Up to 20 dashboards and 20 Genie Spaces (title, domain) |

#### Strategy 2: Vector Semantic Search (when embeddings enabled)

Uses pgvector cosine similarity to retrieve the most relevant knowledge chunks:

- **Embedding model:** `databricks-qwen3-embedding-0-6b` (1024-dim vectors)
- **Top K:** 15 chunks
- **Min score:** 0.35 cosine similarity
- **Scope routing:** Technical intents scope to `estate` kinds; others search all kinds
- **12 embedding kinds:** `table_detail`, `column_profile`, `table_health`,
  `lineage_context`, `environment_insight`, `data_product`, `use_case`,
  `business_context`, `genie_recommendation`, `genie_question`, `outcome_map`,
  `document_chunk`

#### Table Reference Extraction

After RAG retrieval, the engine extracts fully-qualified table names (FQNs) from
the retrieved chunks using multiple strategies:

1. Direct FQN kinds where `sourceId` is the FQN (`table_detail`, `column_profile`, `table_health`)
2. Metadata fields: `tableFqn`, `source`, `target`, `tables[]`
3. Fallback: regex scan for three-part identifiers (`catalog.schema.table`) in estate-scoped chunk content

Up to 20 table FQNs are extracted per response.

#### Table Enrichment

For each extracted table FQN, the engine fetches deep metadata from Lakebase:

| Field | Source |
|-------|--------|
| Owner, size, row count, format | `ForgeTableDetail` |
| Domain, tier, created by | `ForgeTableDetail` |
| Health score, issues, recommendations | `ForgeTableHistorySummary` |
| Last write timestamp/operation | `ForgeTableHistorySummary` |
| Upstream/downstream tables | `ForgeTableLineage` |

Enrichments are formatted as structured markdown and appended to the LLM context,
then also sent to the frontend for the context panel.

#### Context Merge

The final context string is assembled in order:

1. Direct Lakebase context (business + estate + deployed assets)
2. RAG-retrieved context (formatted with provenance labels)
3. Table enrichment metadata for referenced tables

### Step 3: Prompt Construction

**Module:** `lib/assistant/prompts.ts`

Builds the system and user messages for the LLM.

**System prompt** defines the Forge persona with strict grounding rules:

- Never assume or invent table/column names
- Never say "assuming you have X" -- only reference what exists in the context
- Use ONLY real FQNs from the retrieved context in SQL proposals
- Follow `DATABRICKS_SQL_RULES` for all SQL generation
- Cite sources using `[1]`, `[2]` markers
- Structure responses: Direct Answer, What We Know, Technical Implementation, What's Missing, Recommended Actions

**User message** is constructed from the template:

```
## Retrieved Context
{ragContext}

## Conversation History
{conversationHistory}

## User Question
{question}
```

Conversation history includes the last 10 turns, each truncated to 500 characters.

### Step 4: LLM Streaming

The engine calls `chatCompletionStream()` with:

- **Endpoint:** Premium serving endpoint (`getServingEndpoint()`)
- **Temperature:** 0.3
- **Max tokens:** 4,096
- **Streaming:** `onChunk` callback fires for each content delta

Each chunk is immediately forwarded to the client via SSE for real-time display.

### Step 5: Post-Processing

After the stream completes, the engine extracts structured data from the response:

#### SQL Block Extraction (`lib/assistant/sql-proposer.ts`)

Regex-extracts all ` ```sql ... ``` ` code blocks from the markdown response.
The first SQL block becomes the primary actionable query.

#### Dashboard Intent Extraction (`lib/assistant/dashboard-proposer.ts`)

Detects dashboard-related keywords (chart, widget, visualisation, trend) and
extracts:

- Table FQNs referenced in backticks
- Widget descriptions from bullet-point lists containing dashboard-related terms
- Returns a `DashboardProposal` with title, description, tables, and widget descriptions

#### Existing Dashboard Lookup

When the intent is `dashboard`, the engine queries `ForgeDashboardRecommendation`
for the 5 most recent recommendations to avoid duplicate creation.

#### Genie Space Routing

When embeddings are enabled, performs a high-confidence vector search
(min score 0.7) across `genie_recommendation` and `genie_question` kinds to
find an existing Genie Space that could answer the user's question directly.

### Step 6: Action Building

The engine constructs context-aware action cards based on what was extracted:

| Condition | Actions Generated |
|-----------|-------------------|
| SQL blocks found | **Run this SQL**, **Deploy as Notebook** |
| SQL + dashboard intent | **Deploy as Dashboard** |
| Dashboard intent, no SQL | **Create Dashboard** |
| Table FQNs found | **View N Referenced Tables** |
| 2+ table FQNs | **View ERD** |
| Table FQNs found | **Create Genie Space** |
| High-confidence Genie match | **Ask Genie: {Space Title}** (prepended to top) |

### Step 7: Interaction Logging

**Module:** `lib/lakebase/assistant-log.ts`

Every interaction is persisted to the `ForgeAssistantLog` table:

| Field | Content |
|-------|---------|
| `sessionId` | Client-generated UUID per browser session |
| `question` | The user's question |
| `intent` / `intentConfidence` | Classified intent and confidence score |
| `ragChunkIds` | JSON array of source IDs used in RAG retrieval |
| `response` | Full assistant answer text |
| `sqlGenerated` | First SQL block (if any) |
| `durationMs` | Total pipeline duration |
| `promptTokens` / `completionTokens` / `totalTokens` | Token usage |
| `feedbackRating` | Thumbs up/down (updated later via feedback endpoint) |
| `feedbackText` | Optional feedback text |
| `sqlExecuted` / `sqlResult` | Whether the user ran the SQL and the outcome |
| `actionsTaken` | JSON array of actions the user clicked |

---

## API Endpoints

### POST /api/assistant

**File:** `app/api/assistant/route.ts`

Streaming conversational AI endpoint. Returns an SSE stream.

**Request body:**

```json
{
  "question": "How can I calculate Customer Lifetime Value?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "sessionId": "uuid"
}
```

**SSE events:**

| Event Type | Payload | Timing |
|------------|---------|--------|
| `chunk` | `{ type: "chunk", content: "..." }` | During LLM streaming |
| `done` | `{ type: "done", answer, intent, sources, actions, tables, tableEnrichments, sqlBlocks, dashboardProposal, existingDashboards, tokenUsage, durationMs, logId }` | After completion |
| `error` | `{ type: "error", error: "..." }` | On failure |

**Configuration:** `runtime: "nodejs"`, `maxDuration: 120` seconds.

### POST /api/assistant/feedback

**File:** `app/api/assistant/feedback/route.ts`

Submits feedback for a specific assistant response.

**Request body:**

```json
{
  "logId": "uuid",
  "rating": "up" | "down",
  "text": "optional feedback text"
}
```

Updates the `ForgeAssistantLog` entry with the rating.

### GET /api/assistant/conversations

**File:** `app/api/assistant/conversations/route.ts`

Lists conversations for the authenticated user.

**Response:**

```json
{
  "conversations": [
    { "id": "uuid", "title": "...", "sessionId": "uuid", "createdAt": "...", "updatedAt": "..." }
  ],
  "authenticated": true
}
```

Returns `{ conversations: [], authenticated: false }` when no user identity.

### POST /api/assistant/conversations

Creates a new conversation. Used by the SSE endpoint on first message.

### GET /api/assistant/conversations/[conversationId]

**File:** `app/api/assistant/conversations/[conversationId]/route.ts`

Loads a conversation with all its `ForgeAssistantLog` messages. Verifies
user ownership.

### PATCH /api/assistant/conversations/[conversationId]

Renames a conversation. Body: `{ title: "New title" }`.

### DELETE /api/assistant/conversations/[conversationId]

Deletes a conversation and all its `ForgeAssistantLog` entries. Verifies
user ownership.

---

## Frontend Components

### Page Layout (`app/ask-forge/page.tsx` + `ask-forge-content.tsx`)

The page entry point is a thin `"use client"` shell that dynamically imports
`AskForgeContent` with `ssr: false` to avoid `navigator is not defined` errors
during Next.js prerendering.

Three-panel layout occupying the full viewport below the navigation bar:

- **Left sidebar (collapsible):** `ConversationHistory` -- per-user chat history
- **Center panel (flexible width):** `AskForgeChat` -- the conversation thread
- **Right panel (400px, desktop only):** `AskForgeContextPanel` -- live metadata

Above the panels, `EmbeddingStatus` shows the knowledge base health.

Overlay dialogs:
- `SqlDialog` -- opens when "Run this SQL" is clicked
- `DeployOptions` modal -- opens when "Deploy as Notebook" is clicked
- `DeployDashboardDialog` -- opens when "Deploy as Dashboard" is clicked

Table details are fetched lazily via `GET /api/environment/table/{fqn}` when
the assistant references tables (up to 10 concurrent requests). An AbortController
cancels in-flight detail requests when the user switches conversations.

### ConversationHistory (`components/assistant/conversation-history.tsx`)

ChatGPT-style history sidebar showing the current user's conversations:

- Fetches from `GET /api/assistant/conversations` (per-user, most recent first)
- Groups conversations by date: Today, Yesterday, Last 7 Days, Last 30 Days, Older
- **New Conversation** button resets the chat to a fresh session
- Click a conversation to load its messages via `GET /api/assistant/conversations/[id]`
- Inline rename (pencil icon) via `PATCH /api/assistant/conversations/[id]`
- Delete with confirmation via `DELETE /api/assistant/conversations/[id]`
- Collapsible: chevron button toggles between full sidebar and icon-only strip
- Only shown when `authenticated: true` from the conversations API
- Auto-refreshes when the chat creates a new conversation (`historyRefreshKey`)

### AskForgeChat (`components/assistant/ask-forge-chat.tsx`)

The core chat component. Supports two render modes:

- **`full`** -- spacious layout with max-width constraint (used on the dedicated page)
- **`compact`** -- tighter layout for embedding in sheets or sidebars

**Features:**
- Conversation message thread with user/assistant avatars
- Real-time streaming with blinking cursor indicator
- Intent badge displayed above each assistant response
- Suggested starter questions (CLV, PII, revenue trends, data quality)
- Clear conversation button (invokes `onClear` to start a new session in the parent)
- Feedback thumbs up/down on each response (persisted via `/api/assistant/feedback`)
- External `sessionId` prop ties the component to a specific conversation
- `initialMessages` prop hydrates messages when loading a saved conversation
- `onConversationCreated` callback fired when the backend creates a new conversation
- Imperative handle (`AskForgeChatHandle`) for programmatic question submission

**SSE parsing:** Reads the response stream line-by-line, parsing `data:` prefixed
JSON events. Content chunks are appended in real-time; the `done` event finalises
the message with sources, actions, intent, and enrichments.

**Action routing:**

| Action Type | Behaviour |
|-------------|-----------|
| `run_sql` | Opens SQL dialog (full mode) or inline runner (compact) |
| `deploy_notebook` | Opens deploy options modal or inline form |
| `deploy_dashboard` | Opens dashboard deploy dialog, generates + deploys via ad-hoc engine |
| `view_tables` | Navigates to table detail or environment tables page |
| `view_erd` | Navigates to environment ERD tab |
| `create_genie_space` | Navigates to `/metadata-genie` |
| `start_discovery` | Navigates to `/configure` |
| `view_run` | Navigates to `/runs/{runId}` |
| `ask_genie` | Opens Genie Space URL in new tab |
| `export_report` | Navigates to environment overview |

**SQL error recovery:** When SQL execution fails, the "Ask Forge to fix" button
pre-fills the input with the SQL and error message, creating a conversational
fix loop.

### AskForgeContextPanel (`components/assistant/ask-forge-context-panel.tsx`)

Side panel that displays rich metadata for all tables referenced in the
assistant's response.

**Sections:**

1. **Referenced Tables** -- expandable `RichTableCard` for each table
2. **Lineage** -- upstream/downstream summary per table
3. **Sources** -- RAG source cards with kind labels and similarity scores
4. **ERD button** -- opens full-screen ERD modal when 2+ tables are referenced

**RichTableCard** shows:

| Always Visible | Expanded Detail |
|---------------|-----------------|
| Table name (linked), schema path | Full description |
| Health score badge (colour-coded) | Owner, size, governance score |
| Domain/tier, row count, freshness | Last write timestamp and operation |
| PII column count | Write/merge counts, streaming status |
| Sensitivity badge | Column list (first 12, with PII highlighted) |
| | Data quality issues (first 3) |
| | Related use cases (first 4, with scores) |
| | LLM-generated insights (first 3, severity-coded) |
| | "Ask Forge about this table" button |

### AnswerStream (`components/assistant/answer-stream.tsx`)

Renders the assistant's markdown response in real-time with a blinking cursor
animation during streaming. Uses `react-markdown` with `remark-gfm` for full
GitHub Flavored Markdown support:

- GFM tables with styled headers and compact cells
- Fenced code blocks with `SyntaxHighlighter` and copy button
- Inline code with muted background
- Headers (h1-h4) with proper spacing
- Bold, italic, strikethrough, links
- Citation markers `[1]` injected as styled superscript spans before markdown parsing
- Ordered and unordered lists
- Blockquotes
- Tailwind Typography (`prose`) classes for consistent styling

Auto-scrolls to keep the latest content visible. The `@tailwindcss/typography`
plugin is enabled in `globals.css`.

### SourceCardList / SourceCard (`components/assistant/source-card.tsx`)

Expandable cards showing the RAG sources that informed the response:

- Numbered index matching citation markers in the answer text
- Kind-specific icon (table, column, health, lineage, insight, etc.)
- Provenance badge: **Platform** (verified metadata), **Insight** (AI-generated
  estate intelligence), **Generated** (pipeline outputs), **Uploaded** (user
  documents), **Template** (outcome maps)
- Cosine similarity score as percentage
- Expandable detail: full label text and metadata key-value pairs
- Shows first 3 sources by default, "Show all" toggle for more

### ActionCardList / ActionCard (`components/assistant/action-card.tsx`)

Horizontally wrapped action buttons with type-specific icons and styling:

| Type | Icon | Style |
|------|------|-------|
| `run_sql` | Play | Primary (filled) |
| `deploy_notebook` | BookOpen | Outline |
| `deploy_dashboard` | LayoutDashboard | Primary (filled) |
| `create_genie_space` | Sparkles | Outline |
| `view_tables` | Table2 | Secondary |
| `view_erd` | GitBranch | Secondary |
| `start_discovery` | Rocket | Outline |
| `export_report` | Download | Secondary |
| `view_run` | Eye | Secondary |
| `ask_genie` | ExternalLink | Outline |

### SqlRunner (`components/assistant/sql-runner.tsx`)

Inline SQL execution component (used in compact mode):

- Displays SQL in a read-only code block
- **Edit** toggle switches to a textarea for query modification
- **Copy** button with clipboard feedback
- **Run** button executes via `POST /api/sql/execute`
- Success: shows result table (100 row limit), duration, row count, CSV export
- Error: shows error message with "Ask Forge to fix" button
- CSV export generates a downloadable file from the result set

### SqlDialog (`components/assistant/sql-dialog.tsx`)

Modal SQL execution (used in full-page mode):

- Same capabilities as SqlRunner in a Dialog overlay
- Maximum width 4xl, 85vh max height
- Additional toolbar: Run, Copy, Edit, Deploy as Notebook
- Type information shown on column headers
- Scrollable result table with truncated cells

### DeployOptions (`components/assistant/deploy-options.tsx`)

Notebook deployment form:

- Customisable title (default: "Forge Assistant Query")
- Customisable workspace path (default: `/Shared/forge_assistant/`)
- Deploys via `POST /api/sql/deploy` with `target: "notebook"`
- Shows success (deployed path) or error state

### DeployDashboardDialog (`components/assistant/deploy-dashboard-dialog.tsx`)

Dashboard generation and deployment via the ad-hoc dashboard engine:

- Displays the dashboard proposal: title, description, referenced tables, proposed widgets
- Shows SQL context when available (optional -- engine generates its own from column schemas)
- "Deploy Dashboard" calls `POST /api/dashboard/generate` with full conversation context
- The ad-hoc engine maps conversation intent into the dashboard design prompt:
  - `conversationSummary` → `businessContext.strategicGoals` (steers LLM focus)
  - `widgetDescriptions` → synthetic use case statements (tells LLM what to visualise)
  - `domainHint` → domain (names the dashboard around user's topic)
  - `sqlBlocks` → synthetic use case SQL (bonus context for the LLM)
- Shows progress ("Designing and deploying dashboard...") then success with a link to the deployed Lakeview dashboard in Databricks

### EmbeddingStatus (`components/assistant/embedding-status.tsx`)

Knowledge base status bar shown above the chat:

- **Disabled state:** amber warning banner when embedding endpoint is not configured
- **Enabled state:** collapsible bar showing vector count with green checkmark
- **Expanded view:** breakdown by scope (Estate, Pipeline, Genie, Documents)
  and by kind (table detail, column profile, etc.)
- **Rebuild Embeddings** button triggers `POST /api/embeddings/backfill`

### ErdModal (`components/assistant/erd-modal.tsx`)

Full-screen entity-relationship diagram viewer:

- Fetches the complete ERD graph via `GET /api/environment/aggregate/erd?format=json&includeLineage=true`
- Filters to the referenced tables plus their 1-hop neighbours
- Calculates edge statistics (FK, implicit, lineage counts)
- Lazy-loads the `ERDViewer` component for interactive graph rendering
- Escape key to close
- Shows table and relationship counts in the header

### AskForgePanel (`components/assistant/ask-forge-panel.tsx`)

Header navigation trigger:

- Button with BrainCircuit icon and "Ask Forge" label
- Keyboard shortcut badge (Cmd+J)
- Cmd+J / Ctrl+J toggles between `/ask-forge` and the previous page
- Active state styling when on the Ask Forge page

---

## Data Flow

### Question Lifecycle

```
User types question
        │
        ▼
AskForgeChat.handleSubmit()
  ├── Creates user + assistant message placeholders
  ├── POST /api/assistant { question, history, sessionId }
  │
  ▼
API Route: ReadableStream SSE
  │
  ├── runAssistantEngine()
  │   ├── classifyIntent() ──────────────────► Fast model
  │   ├── buildAssistantContext()
  │   │   ├── fetchDirectLakebaseContext() ──► Lakebase (Prisma)
  │   │   ├── retrieveContext() ─────────────► pgvector search
  │   │   ├── extractTableReferences() ──────► FQN extraction
  │   │   └── fetchTableEnrichments() ───────► Lakebase (deep detail)
  │   ├── buildAssistantMessages() ──────────► Prompt assembly
  │   ├── chatCompletionStream() ────────────► Premium model (streaming)
  │   │   └── onChunk() ────────────────────► SSE: { type: "chunk" }
  │   ├── extractSqlBlocks()
  │   ├── extractDashboardIntent()
  │   ├── [dashboard lookup]
  │   ├── [Genie space routing]
  │   ├── buildActions()
  │   └── createAssistantLog() ──────────────► Lakebase persistence
  │
  └── SSE: { type: "done", answer, intent, sources, actions, ... }
        │
        ▼
AskForgeChat processes "done" event
  ├── Updates message with final content, sources, actions, intent
  ├── onTableEnrichments() ──► Context panel updates
  ├── onReferencedTables() ──► Triggers table detail fetch
  └── onSources() ──────────► Context panel source list

User clicks action
  ├── "Run this SQL" ──────► SqlDialog opens
  ├── "Deploy as Notebook" ► DeployOptions modal
  ├── "Deploy as Dashboard"► DeployDashboardDialog
  ├── "View Tables" ───────► Navigation to environment
  ├── "View ERD" ──────────► ErdModal opens
  └── "Ask Genie" ────────► External Genie Space URL

User provides feedback
  └── POST /api/assistant/feedback { logId, rating }
      └── updateAssistantLog() ──► Lakebase update
```

### Conversation Persistence

Conversations are persisted to the `ForgeConversation` Lakebase table. Each
conversation is associated with a `userId` (from `x-forwarded-email` header)
and linked to `ForgeAssistantLog` entries via the shared `sessionId`.

**On first message:** The API route creates a new `ForgeConversation` record
with the question as the title and returns the `conversationId` in the SSE
`done` event. The frontend adds it to the history sidebar.

**On subsequent messages:** The API route calls `touchConversation()` to
update the `updatedAt` timestamp.

**Loading a conversation:** The frontend fetches
`GET /api/assistant/conversations/[id]` which returns the conversation metadata
plus all `ForgeAssistantLog` entries (mapped to `ConversationMessage[]`).

### In-Flight Conversation Memory

The frontend maintains the full conversation history in component state.
On each new question, the last 10 non-streaming messages are sent as
`history` to the API. The context builder formats these as labelled turns
(truncated to 500 chars each) and injects them into the user prompt between
the RAG context and the current question.

---

## Embedding / RAG Pipeline

Ask Forge's answer quality depends on the vector knowledge base. The embedding
pipeline is documented separately but the key integration points are:

| Concern | Module | Detail |
|---------|--------|--------|
| Feature gate | `lib/embeddings/config.ts` | `isEmbeddingEnabled()` checks `DATABRICKS_EMBEDDING_ENDPOINT` env var |
| Embedding client | `lib/embeddings/client.ts` | `databricks-qwen3-embedding-0-6b`, 1024-dim, batches of 16, retry on 429/5xx |
| Vector store | `lib/embeddings/store.ts` | pgvector in Lakebase, HNSW index, `forge_embeddings` table |
| Retriever | `lib/embeddings/retriever.ts` | `retrieveContext()` with scope/kind filtering, `formatRetrievedContext()` with provenance labels |
| Text composition | `lib/embeddings/compose.ts` | 12 composing functions, one per embedding kind |
| Estate embedding | `lib/embeddings/embed-estate.ts` | Embeds scan results (tables, health, insights, lineage) |
| Pipeline embedding | `lib/embeddings/embed-pipeline.ts` | Embeds run results (use cases, business context, Genie) |
| Backfill | `POST /api/embeddings/backfill` | Rebuilds all embeddings from current Lakebase data |

**Graceful degradation:** When embeddings are disabled, Ask Forge still works
using only the direct Lakebase context strategy. The `hasDataGaps` flag in
`AssistantContext` is set when both strategies return empty results.

---

## File Inventory

### Backend (lib/assistant/)

| File | Purpose |
|------|---------|
| `engine.ts` | Main pipeline orchestrator: intent → context → LLM → actions |
| `intent.ts` | LLM-based intent classification with heuristic fallback |
| `context-builder.ts` | Dual-strategy context pipeline (Lakebase + RAG) |
| `prompts.ts` | System prompt, user template, message builder |
| `sql-proposer.ts` | SQL execution, validation (EXPLAIN), block extraction |
| `dashboard-proposer.ts` | Dashboard intent detection and proposal extraction |

### Backend (API routes)

| File | Purpose |
|------|---------|
| `app/api/assistant/route.ts` | SSE streaming endpoint (creates conversations) |
| `app/api/assistant/feedback/route.ts` | Feedback submission endpoint |
| `app/api/assistant/conversations/route.ts` | List / create conversations |
| `app/api/assistant/conversations/[conversationId]/route.ts` | Get / rename / delete a conversation |
| `app/api/assistant/suggestions/route.ts` | Dynamic suggested questions |

### Backend (persistence)

| File | Purpose |
|------|---------|
| `lib/lakebase/assistant-log.ts` | CRUD for `ForgeAssistantLog` table |
| `lib/lakebase/conversations.ts` | CRUD for `ForgeConversation` table (per-user chat history) |

### Frontend (components/assistant/)

| File | Purpose |
|------|---------|
| `ask-forge-chat.tsx` | Main chat component (messages, input, SSE, actions, onClear) |
| `ask-forge-context-panel.tsx` | Side panel with table detail, expandable sources, AI insight fallback |
| `ask-forge-panel.tsx` | Header button and Cmd+J keyboard shortcut |
| `conversation-history.tsx` | ChatGPT-style per-user conversation sidebar |
| `answer-stream.tsx` | Real-time markdown rendering via react-markdown + remark-gfm |
| `source-card.tsx` | RAG source cards with provenance and score |
| `action-card.tsx` | Contextual action buttons |
| `sql-runner.tsx` | Inline SQL execution with results table |
| `sql-dialog.tsx` | Modal SQL execution with full editing |
| `deploy-options.tsx` | Notebook deployment form |
| `deploy-dashboard-dialog.tsx` | Dashboard deployment preview and confirmation |
| `embedding-status.tsx` | Knowledge base status bar with rebuild |
| `erd-modal.tsx` | Full-screen ERD viewer for referenced tables |
| `dashboard-preview.tsx` | Dashboard design preview |
| `erd-preview.tsx` | Mermaid ERD code preview |
| `table-card.tsx` | Compact table metadata card |

### Frontend (page)

| File | Purpose |
|------|---------|
| `app/ask-forge/page.tsx` | Thin client shell with dynamic import (ssr: false) |
| `app/ask-forge/ask-forge-content.tsx` | Three-panel layout: history, chat, context panel + dialog orchestration |

---

## Configuration

| Environment Variable | Required | Purpose |
|---------------------|----------|---------|
| `DATABRICKS_HOST` | Yes | Databricks workspace URL |
| `DATABRICKS_TOKEN` | Local dev | PAT for local development |
| `DATABRICKS_EMBEDDING_ENDPOINT` | No | Enables vector search (recommended) |
| `serving-endpoint` | Yes | Premium model for answer generation |
| `serving-endpoint-fast` | No | Fast model for intent classification |

Ask Forge works without the embedding endpoint but provides significantly
richer answers when semantic search is enabled.
