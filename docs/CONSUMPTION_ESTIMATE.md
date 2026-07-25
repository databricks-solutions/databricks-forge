# Forge — Consumption Estimate (DBUs / USD)

> Reference document to support **cost estimation** of running Databricks Forge inside the customer's workspace. All consumption described here is billed **in the customer's workspace** (not the deployer's). The app does not dispatch any Databricks Jobs — only Model Serving, SQL Warehouse, and Lakebase.

---

## 1. Pricing assumptions (list price)

> Replace with the customer's contracted rates when available. Values in **USD** assume Premium Tier.

| SKU | Rate | Notes |
|---|---|---|
| Foundation Model API — Claude Opus 4 (premium) | **$15 / 1M input tokens** · **$75 / 1M output tokens** | Pay-per-token; used for SQL generation, scoring, Genie |
| Foundation Model API — Claude Sonnet 4 (fast) | **$3 / 1M input tokens** · **$15 / 1M output tokens** | Pay-per-token; used for filtering, clustering, comments |
| Foundation Model API — GPT‑5 (review) | **$5 / 1M input** · **$15 / 1M output** *(estimate)* | Pay-per-token; opt‑in SQL review |
| Foundation Model API — Embedding (qwen3‑0.6b) | **$0.10 / 1M tokens** | KB ingestion + RAG |
| SQL Warehouse Serverless (Small, 4 DBU/h) | **$0.70 / DBU** → **$2.80/h** | Used for `system.*` queries (WAF / Estate health) |
| Lakebase | Included with the platform | Lightweight persistence; negligible on the bill |

**DBU ↔ USD conversion (Model Serving)**: the table above is in USD/MTok because that is how Foundation Model APIs are priced. To express it as DBU‑equivalent, divide by **$0.07/DBU** (Premium rate):

| Model | DBU/MTok input | DBU/MTok output |
|---|---|---|
| Opus (premium) | 214 | 1,071 |
| Sonnet (fast) | 43 | 214 |
| GPT‑5 (review) | 71 | 214 |

---

## 2. Average cost per LLM call

Token estimates are based on the prompt shape observed across the engines:

| Call type | Average tokens (in / out) | Endpoint | Cost / call | DBU / call |
|---|---|---|---|---|
| Use case generation (batch) | 15,000 / 5,000 | Premium | **$0.60** | 8.6 |
| SQL generation (1 use case) | 8,000 / 2,000 | Premium | **$0.27** | 3.9 |
| Genie pass (column intel, semantic, etc.) | 8,000 / 4,000 | Premium / fast | **$0.30 (premium)** / $0.08 (fast) | 4.3 / 1.1 |
| Filtering / clustering (batch) | 6,000 / 2,000 | Fast | **$0.05** | 0.7 |
| Comment engine (table/column batches) | 5,000 / 2,000 | Fast | **$0.045** | 0.6 |
| Business Value (batch) | 6,000 / 3,000 | Fast | **$0.063** | 0.9 |
| SQL review / repair | 4,000 / 1,000 | Review (GPT‑5) | **$0.035** | 0.5 |
| Ask Forge (intent + answer + RAG) | ~10,000 / ~3,000 | Mix fast+premium | **~$0.10** | ~1.4 |
| Embedding (1 doc / 100‑doc batch) | ~500 / 0 | Embedding | **$0.00005** | <0.001 |

---

## 3. Consumption by feature

### 3.1 Estate Scan (1,000 tables)

| Block | Volume | Cost | DBU |
|---|---|---|---|
| 8 LLM passes in batches of 50 tables | 160 fast calls | $7.68 | 110 |
| 10 health rules × 1,000 tables (warehouse) | ~30–60 min on Serverless Small | $1.40–$2.80 | 2–4 |
| Lineage walk + metadata | 10–20 lightweight queries | <$0.10 | <0.2 |
| **Estate Scan subtotal** |  | **~$9–11** | **~115 DBU** |

### 3.2 Discovery Pipeline (1,000 tables, 50 use cases)

| Step | Volume | Cost | DBU |
|---|---|---|---|
| 1 — Business Context | 1 fast call | $0.05 | 0.7 |
| 2 — Metadata extraction (warehouse) | ~10 queries | <$0.10 | <0.2 |
| 4 — Table filtering | 20 fast batches | $1.00 | 14 |
| 5 — Use case generation | 8 parallel premium batches | $4.80 | 69 |
| 6 — Domain clustering | 1 fast call | $0.05 | 0.7 |
| 7 — Scoring (premium+fast) | 3 calls | ~$1.50 | 21 |
| 8 — SQL generation | 50 premium streaming calls | $13.50 | 193 |
| 9 — Business Value (4 passes) | 8 fast calls | $0.50 | 7 |
| 10 — Genie recommendations (5 domains × 7 passes) | ~200 calls (60% fast, 40% premium) | **$53.80** | 770 |
| **Discovery Pipeline subtotal** |  | **~$75** | **~1,075 DBU** |

> Genie is the most expensive item per engagement — controlling the number of domains and the preset (Speed vs Quality) is the main lever.

### 3.3 Comment Engine (1,000 tables, optional)

| Phase | Volume | Cost | DBU |
|---|---|---|---|
| Phase 0+1 (classification) | 20 fast calls | $1.00 | 14 |
| Phase 2 (table comments) | 100 fast calls | $4.50 | 64 |
| Phase 3 (column comments) | ~500 fast calls (50 cols/table) | $22.50 | 321 |
| Phase 4 (consistency review, opt) | 1 fast call | $0.05 | 0.7 |
| **Comments subtotal** |  | **~$28** | **~400 DBU** |

### 3.4 Ask Forge (RAG)

- **Cost per question**: ~$0.10 / 1.4 DBU (1 fast intent + 1 fast/premium answer + 0–1 review)
- **20 questions/day × 30 days** = 600 questions → **~$60 / 850 DBU/month**
- KB embedding ingestion: negligible (~$0.001 per document).

### 3.5 WAF Assessment

| Item | Frequency | Cost | DBU |
|---|---|---|---|
| 1 assessment run (~30–50 queries on `system.*`) | one‑shot per execution | <$0.05 | <0.1 |
| Lakeview Dashboard (3 pages, ~13 datasets) — daily refresh | 13 queries × 30 days | $0.50–$1.50/month | <2 |
| WAF Genie Space — ad‑hoc questions | ~$0.05/question (Genie uses internal SQL gen + warehouse) | varies | varies |

> WAF is **very cheap** because it operates on `system.*` only (small volume) and the dashboard datasets are lightweight. Serverless Small is the recommended warehouse size.

---

## 4. Sizing scenarios

### 4.1 Small customer (≤200 tables, 20 use cases, 1 Genie domain)

| Block | Cost | DBU |
|---|---|---|
| Estate Scan | $2 | 25 |
| Discovery Pipeline | $20 | 285 |
| Comments (opt) | $6 | 85 |
| WAF Assessment + 30‑day dashboard | $1 | 15 |
| Ask Forge (5 questions/day × 30d) | $15 | 215 |
| **Estimated monthly total** | **~$45** | **~625 DBU** |

### 4.2 Medium customer (1,000 tables, 50 use cases, 5 Genie domains) — **base scenario**

| Block | Cost | DBU |
|---|---|---|
| Estate Scan (1× upfront) | $10 | 115 |
| Discovery Pipeline (1×) | $75 | 1,075 |
| Comments (opt, 1×) | $28 | 400 |
| WAF Assessment + 30‑day dashboard | $1.50 | 20 |
| Ask Forge (20 questions/day × 30d) | $60 | 850 |
| **Estimated monthly total** | **~$175** | **~2,460 DBU** |

### 4.3 Large customer (5,000 tables, 200 use cases, 15 Genie domains)

| Block | Cost | DBU |
|---|---|---|
| Estate Scan | $40 | 570 |
| Discovery Pipeline | $325 | 4,640 |
| Comments (opt) | $140 | 2,000 |
| WAF Assessment + 30‑day dashboard | $3 | 40 |
| Ask Forge (50 questions/day × 30d) | $150 | 2,140 |
| **Estimated monthly total** | **~$660** | **~9,400 DBU** |

> Scaling profile: cost grows **linearly** with table count (filtering, comments, estate scan) and with use cases (SQL gen, business value), but **superlinearly** with Genie domains (each domain triggers 7 premium passes).

---

## 5. Drivers and knobs to reduce consumption

| Knob | Where it applies | Impact |
|---|---|---|
| Disable SQL review (`serving-endpoint-review`) | SQL Engine, Ask Forge | −1 LLM call per generated SQL (~−10–15% of Discovery) |
| Lower `lineage depth` (default 5 → 2) | Estate Scan | −60% lineage queries |
| Cap `maxUseCases` | Discovery (Step 5/8) | SQL gen cost scales 1:1 |
| **Speed** preset on Genie | Genie Engine | More passes routed to fast endpoint (~−40% Genie cost) |
| Reduce `domainConcurrency` | Genie Engine | Doesn't cut cost, cuts wall‑clock; avoids contention |
| `wide-schema mode` (>3K tables) | Discovery | Cuts parallel batches 8 → 3 (smooths peaks) |
| Lakeview / Genie cache | WAF Dashboard, Genie | Avoids re-running datasets |
| **Serverless Small** warehouse | WAF, Estate health | `system.*` is lightweight; bigger sizes don't help |
| Skip Comment Engine if not in scope | Comments | Largest elective block (~$28/1K tables) |

---

## 6. Executive summary (base scenario — 1,000 tables)

- **Single engagement** (1 estate scan + 1 discovery + 1 WAF + comments): **~$115 / ~1,620 DBU**
- **30‑day operation** (warm usage, daily dashboard, 20 questions/day in Ask Forge): **~$175 / ~2,460 DBU**
- **Almost 100% of the cost is Model Serving (Foundation Model APIs)**. SQL Warehouse stays under **$5/month** even in the large scenario.

> **Caveat**: the figures above are estimates based on list price and average tokens observed in the prompts. Variations of ±30% are expected depending on customer schema shape, presets (Speed/Quality), and SQL repair retry counts.

---

## 7. How to measure actual consumption after deployment

1. Enable the system tables `system.serving.endpoint_usage` (token usage per endpoint) and `system.billing.usage` (DBUs per SKU).
2. Filter by the app's workspace/user (`workspace_id`, `identity_metadata`) and by the engagement window.
3. The Forge WAF dashboard already has a **Compute / Warehouses** tab that can be extended to track the app's consumption.
4. `ForgePromptLog` (Lakebase) records every LLM call with token counts — useful to reconcile against `system.serving.endpoint_usage`.
