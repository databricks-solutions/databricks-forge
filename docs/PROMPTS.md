# Prompt Template Catalog

> All prompt templates used by the pipeline, defined in
> `lib/ai/templates.ts`. Auto-versioned via SHA-256 content hashes —
> see `PROMPT_VERSIONS` in the same file.

## Template Index

| # | Template Key | Pipeline Step | Output Format | Status |
|---|-------------|---------------|---------------|--------|
| 1 | BUSINESS_CONTEXT_WORKER_PROMPT | business-context | JSON (honesty-wrapped) | Active |
| 2 | FILTER_BUSINESS_TABLES_PROMPT | table-filtering | CSV | Active |
| 3 | BASE_USE_CASE_GEN_PROMPT | (base for 4 & 5) | CSV | Active |
| 4 | AI_USE_CASE_GEN_PROMPT | usecase-generation | CSV | Active |
| 5 | STATS_USE_CASE_GEN_PROMPT | usecase-generation | CSV | Active |
| 6 | DOMAIN_FINDER_PROMPT | domain-clustering | JSON array | Active |
| 7 | SUBDOMAIN_DETECTOR_PROMPT | domain-clustering | JSON array | Active |
| 8 | DOMAINS_MERGER_PROMPT | domain-clustering | JSON (honesty-wrapped) | Active |
| 9 | SCORE_USE_CASES_PROMPT | scoring | JSON array | Active |
| 10 | REVIEW_USE_CASES_PROMPT | scoring (dedup) | JSON array | Active |
| 11 | GLOBAL_SCORE_CALIBRATION_PROMPT | scoring (calibration) | JSON array | Active |
| 12 | CROSS_DOMAIN_DEDUP_PROMPT | scoring (cross-domain dedup) | JSON array | Active |
| 13 | USE_CASE_SQL_GEN_PROMPT | sql-generation | Raw SQL | Active |
| 14 | USE_CASE_SQL_FIX_PROMPT | sql-generation (fix/retry) | Raw SQL | Active |
| 15 | SUMMARY_GEN_PROMPT | export (PDF/PPTX) | JSON array | Defined, not wired |
| 16 | KEYWORDS_TRANSLATE_PROMPT | export (multi-lang) | JSON | Defined, not wired |
| 17 | USE_CASE_TRANSLATE_PROMPT | export (multi-lang) | JSON | Defined, not wired |

> **Output language note.** Use case generation honours `outputLanguage`
> (`"en"` | `"pt-BR"` | `"es"`) by injecting `{output_language_directive}`
> into `AI_USE_CASE_GEN_PROMPT` and `STATS_USE_CASE_GEN_PROMPT` (see entry below).
> The `{output_language}` placeholder listed for `DOMAIN_FINDER_PROMPT`,
> `SUBDOMAIN_DETECTOR_PROMPT`, and similar templates is documented but **not
> yet supplied at runtime** — those steps still produce English output. See
> [ROADMAP.md item #17](ROADMAP.md#17-multi-language-support-i18n).

---

## Per-Prompt Temperature Configuration

Temperatures are configured per-prompt in `lib/ai/agent.ts` via the
`PROMPT_TEMPERATURES` map, ported from the reference notebook's
`TECHNICAL_CONTEXT`:

| Prompt | Temperature | Rationale |
|--------|-------------|-----------|
| BUSINESS_CONTEXT_WORKER_PROMPT | 0.3 | Semi-structured reasoning |
| FILTER_BUSINESS_TABLES_PROMPT | 0.2 | Deterministic classification |
| BASE_USE_CASE_GEN_PROMPT | 0.7 | Creative generation |
| AI_USE_CASE_GEN_PROMPT | 0.8 | Maximum creative diversity |
| STATS_USE_CASE_GEN_PROMPT | 0.7 | Creative generation |
| DOMAIN_FINDER_PROMPT | 0.5 | Semi-structured taxonomy |
| SUBDOMAIN_DETECTOR_PROMPT | 0.4 | Semi-structured taxonomy |
| DOMAINS_MERGER_PROMPT | 0.4 | Semi-structured merging |
| SCORE_USE_CASES_PROMPT | 0.2 | Deterministic scoring |
| REVIEW_USE_CASES_PROMPT | 0.3 | Deterministic dedup |
| GLOBAL_SCORE_CALIBRATION_PROMPT | 0.2 | Deterministic calibration |
| CROSS_DOMAIN_DEDUP_PROMPT | 0.3 | Deterministic dedup |
| USE_CASE_SQL_GEN_PROMPT | 0.1 | Precise SQL generation |
| USE_CASE_SQL_FIX_PROMPT | 0.1 | Precise SQL fixing |
| SUMMARY_GEN_PROMPT | 0.5 | Semi-creative writing |
| KEYWORDS_TRANSLATE_PROMPT | 0.2 | Deterministic translation |
| USE_CASE_TRANSLATE_PROMPT | 0.3 | Semi-deterministic translation |

---

## Template Details

### 1. BUSINESS_CONTEXT_WORKER_PROMPT

**Step:** business-context
**Purpose:** Extracts business context, strategic goals, priorities, value chain,
and revenue model from an industry/business name.

**Key features:**
- 3-step chain-of-thought workflow (Research → Gather → Construct)
- Constrained strategic goals taxonomy (8 standard goals, pick 3-7)
- Per-field quality guidance (length, specificity, tone)
- Honesty score self-assessment

**Input variables:**
- `{industry}` — detected or user-supplied industry
- `{name}` — business/organisation name
- `{type_description}` — description of the analysis type
- `{type_label}` — label for the output type

**Expected output:** JSON object wrapped in honesty scoring:
```json
{
  "honesty_score": 0.85,
  "industries": "...",
  "strategic_goals": "Reduce Cost (elaboration), Increase Revenue (elaboration), ...",
  "business_priorities": "...",
  "strategic_initiative": "...",
  "value_chain": "...",
  "revenue_model": "...",
  "additional_context": "..."
}
```

---

### 2. FILTER_BUSINESS_TABLES_PROMPT

**Step:** table-filtering
**Purpose:** Classifies tables as business-relevant vs technical/system tables.

**Key features:**
- Data category definitions (Transactional, Master, Reference) to guide classification
- Universal technical patterns list (`*_logs`, `*_audit_trail`, `*_snapshot`, etc.)
- 3 industry-specific few-shot examples (Data Platform, Healthcare, Logistics)
- Classification priority rules (semantic analysis first)

**Input variables:**
- `{business_name}` — organisation name
- `{industry}` — detected industry
- `{business_context}` — from Step 1
- `{exclusion_strategy}` — rules for excluding tables
- `{additional_context_section}` — extra context
- `{strategy_rules}` — filtering strategy rules
- `{tables_markdown}` — markdown list of tables

**Expected output:** CSV with columns:
`table_fqn, classification, reason`

---

### 3. BASE_USE_CASE_GEN_PROMPT

**Step:** usecase-generation (base template)
**Purpose:** Base prompt for use case generation; extended by AI and Stats prompts.

**Key features:**
- **Critical anti-hallucination block** — every use case must reference real tables from the schema
- **Mandatory 5-point realism test** — logical causation, industry recognition, executive credibility, domain expert validation, boardroom test
- **Improved column instructions** — business-oriented naming (Anticipate, Predict, Detect), no specific percentages in Business Value, SELECT DISTINCT in Technical Design
- **Self-validation checklist** — verify before finalizing

**Input variables:**
- `{business_context}`, `{strategic_goals}`, `{business_priorities}`
- `{strategic_initiative}`, `{value_chain}`, `{revenue_model}`
- `{additional_context_section}`, `{focus_areas_instruction}`
- `{ai_functions_summary}`, `{statistical_functions_detailed}`
- `{schema_markdown}`, `{foreign_key_relationships}`
- `{previous_use_cases_feedback}`, `{target_use_case_count}`
- `{output_language_directive}` — optional natural-language directive injected near the top of `AI_USE_CASE_GEN_PROMPT` and `STATS_USE_CASE_GEN_PROMPT`. Computed by `lib/pipeline/steps/usecase-generation.ts:buildOutputLanguageDirective()` from `run.config.outputLanguage`. Empty string for English (default); for `pt-BR` and `es` it instructs the LLM to write the natural-language fields (`name`, `statement`, `solution`, `business_value`, `beneficiary`, `sponsor`, `technical_design`) in the chosen language while keeping technical identifiers (FQNs, AI/SQL function names, JSON keys, `analytics_technique` values) in English.

**Expected output:** CSV with columns:
`No, Name, type, Analytics Technique, Statement, Solution, Business Value, Beneficiary, Sponsor, Tables Involved, Technical Design`

---

### 4. AI_USE_CASE_GEN_PROMPT

**Step:** usecase-generation
**Purpose:** Generates AI-focused use cases leveraging ai_forecast, ai_classify,
ai_query, ai_summarize, ai_extract, etc.

**Key features (in addition to base):**
- Anti-hallucination block
- AI function pairing guidance (e.g., ai_forecast + ai_query, ai_classify + ai_analyze_sentiment)
- Realism test
- Analytics Technique must be a specific AI function name

**Input variables:** Same as BASE_USE_CASE_GEN_PROMPT with:
- `{ai_functions_summary}` — summary of available AI functions

**Expected output:** Same CSV format as BASE_USE_CASE_GEN_PROMPT.

---

### 5. STATS_USE_CASE_GEN_PROMPT

**Step:** usecase-generation
**Purpose:** Generates statistics-focused use cases (anomaly detection,
simulation, geospatial, trend analysis, etc.)

**Key features (in addition to base):**
- Anti-hallucination block
- Comprehensive statistics requirement (3-5 statistical functions per use case)
- Function combination guidance (e.g., STDDEV_POP + PERCENTILE_APPROX + SKEWNESS for anomaly detection)
- Realism test

**Input variables:** Same as BASE_USE_CASE_GEN_PROMPT with:
- `{statistical_functions_detailed}` — detailed statistical functions reference

**Expected output:** Same CSV format as BASE_USE_CASE_GEN_PROMPT.

---

### 6. DOMAIN_FINDER_PROMPT

**Step:** domain-clustering
**Purpose:** Assigns use cases to 3-25 business domains (one-word names).

**Key features:**
- Anti-consolidation rule with formula (target = use_cases / 10)
- Industry-specific domain name examples (Banking, Healthcare, Retail, Manufacturing)
- Retry with previous violations

**Input variables:**
- `{business_name}`, `{industries}`, `{business_context}`
- `{use_cases_csv}` — all use cases as CSV
- `{previous_violations}` — any prior constraint violations
- `{output_language}` — target language

**Expected output:** JSON array:
```json
[{"no": 1, "domain": "Finance"}, {"no": 2, "domain": "Marketing"}]
```

---

### 7. SUBDOMAIN_DETECTOR_PROMPT

**Step:** domain-clustering
**Purpose:** Assigns 2-10 subdomains within a single domain.

**Key features:**
- 2-word naming rule (mandatory)
- Semantic grouping by business outcome, not technique
- Example showing domain-to-subdomain mapping
- No single-item subdomains

**Input variables:**
- `{domain_name}` — the parent domain
- `{business_name}`, `{industries}`, `{business_context}`
- `{use_cases_csv}` — use cases in this domain
- `{previous_violations}` — prior violations
- `{output_language}` — target language

**Expected output:** JSON array:
```json
[{"no": 1, "subdomain": "Revenue Optimization"}, {"no": 2, "subdomain": "Cost Control"}]
```

---

### 8. DOMAINS_MERGER_PROMPT

**Step:** domain-clustering
**Purpose:** Merges small domains (below minimum threshold) into larger ones.

**Key features:**
- Semantic overlap preference (not just largest domain)
- Honesty score self-assessment

**Input variables:**
- `{min_cases_per_domain}` — minimum use cases per domain
- `{domain_info_str}` — domain name + count listing

**Expected output:** JSON object (honesty-wrapped):
```json
{"SmallDomain1": "TargetDomain1", "SmallDomain2": "TargetDomain2"}
```

---

### 9. SCORE_USE_CASES_PROMPT

**Step:** scoring
**Purpose:** Scores use cases on priority, feasibility, impact, and overall dimensions.

**Key features (major upgrade):**
- **Value Score rubric (4 weighted factors):**
  - ROI (60%) — 5-level ladder with concrete examples
  - Strategic Alignment (25%) — direct hit / strong link / weak definitions
  - Time to Value (7.5%) — weeks / months / years ladder
  - Reusability (7.5%) — platform asset / modular / one-off
- **Feasibility Score rubric (8 factors, simple average):**
  - Data Availability, Data Accessibility, Architecture Fitness, Team Skills
  - Domain Knowledge, People Allocation, Budget Allocation, Time to Production
- **Value-First Formula:** overall_score = (Value × 0.75) + (Feasibility × 0.25)
- **Scoring rules:** No forced distribution, zero-based scoring, strategic goal bonus
- **Business relevancy penalties:** Irrelevant correlations, nonsensical external data, boardroom test
- **Chain-of-thought:** LLM computes sub-factors internally, outputs final 4 scores

**Input variables:**
- `{business_context}`, `{strategic_goals}`, `{business_priorities}`
- `{strategic_initiative}`, `{value_chain}`, `{revenue_model}`
- `{use_case_markdown}` — use cases formatted as markdown table

**Expected output:** JSON array:
```json
[{"no": 1, "priority_score": 0.7, "feasibility_score": 0.6, "impact_score": 0.8, "overall_score": 0.68}]
```

---

### 10. REVIEW_USE_CASES_PROMPT

**Step:** scoring (per-domain deduplication)
**Purpose:** Detects duplicate and low-quality use cases for removal.

**Key features:**
- Aggressive semantic duplicate detection with examples
- Quality rejection criteria: no business outcome, irrelevant correlation, purely technical, vague/generic, boardroom test failure

**Input variables:**
- `{total_count}` — total use case count
- `{use_case_markdown}` — use cases formatted as markdown table

**Expected output:** JSON array:
```json
[{"no": 1, "action": "keep", "reason": "Unique concept"}, {"no": 2, "action": "remove", "reason": "Duplicate of #1"}]
```

---

### 11. GLOBAL_SCORE_CALIBRATION_PROMPT

**Step:** scoring (global calibration)
**Purpose:** Re-calibrates scores across all domains for consistency on a single global scale.

**Key features:**
- References Value-First framework (Value × 0.75 + Feasibility × 0.25)
- Explicit score ladder (0.8+ = exceptional, 0.5-0.79 = solid, 0.3-0.49 = modest, <0.3 = weak)
- Absolute merit scoring, no curve

**Input variables:**
- `{business_context}`, `{strategic_goals}`
- `{use_case_markdown}` — top use cases from each domain

**Expected output:** JSON array:
```json
[{"no": 1, "overall_score": 0.72}, {"no": 2, "overall_score": 0.55}]
```

---

### 12. CROSS_DOMAIN_DEDUP_PROMPT

**Step:** scoring (cross-domain deduplication)
**Purpose:** Identifies semantically duplicate use cases across different domains.

**Key features:**
- 5 examples of cross-domain duplicates
- "NOT duplicates" examples to prevent over-flagging
- Score-based retention rules

**Input variables:**
- `{use_case_markdown}` — all use cases with domain and score

**Expected output:** JSON array:
```json
[{"no": 5, "duplicate_of": 12, "reason": "Same churn prediction concept, #12 has higher score"}]
```

---

### 13. USE_CASE_SQL_GEN_PROMPT

**Step:** sql-generation
**Purpose:** Generates production-grade Databricks SQL for a single use case.

**Key features (major upgrade):**
- **Shared SQL quality rules** — imports `DATABRICKS_SQL_RULES` from `lib/ai/sql-rules.ts`
- **SELECT DISTINCT first-CTE rule** — mandatory deduplication before analysis
- **Persona enrichment for ai_query** — every AI persona must include business_name, context, goals, priorities
- **ai_sys_prompt column** — mandatory last column capturing the exact prompt for auditability
- **Business-friendly CTE names** — descriptive names like `customer_lifetime_value`, not `cte1`
- **End marker** — `--END OF GENERATED SQL`
- Comprehensive AI function and statistical function usage rules

**Input variables:**
- `{business_name}`, `{business_context}`, `{strategic_goals}`
- `{business_priorities}`, `{strategic_initiative}`, `{value_chain}`, `{revenue_model}`
- `{use_case_id}`, `{use_case_name}`, `{business_domain}`
- `{use_case_type}`, `{analytics_technique}`, `{statement}`, `{solution}`
- `{tables_involved}`, `{directly_involved_schema}`, `{foreign_key_relationships}`
- `{sample_data_section}`, `{ai_functions_summary}`, `{statistical_functions_detailed}`
- `{sql_model_serving}` — model endpoint for ai_query calls

**Expected output:** Raw SQL (no markdown fences), starting with `-- Use Case:` comment, ending with `--END OF GENERATED SQL`.

---

### 14. USE_CASE_SQL_FIX_PROMPT

**Step:** sql-generation (fix/retry)
**Purpose:** Fixes SQL that failed execution by incorporating the error message.

**Key features:**
- Fix-only philosophy (no logic changes, no optimization, no new features)
- Preserves ai_sys_prompt column and end marker if present
- Extended common fixes list (ai_query errors, AI_FORECAST errors)

**Input variables:**
- `{use_case_name}`, `{use_case_id}`
- `{original_sql}` — the SQL that failed
- `{error_message}` — the error from execution
- `{directly_involved_schema}` — available tables and columns
- `{foreign_key_relationships}` — FK relationships

**Expected output:** Raw SQL (corrected).

---

### 15. SUMMARY_GEN_PROMPT

**Step:** export (PDF/PPTX generation) — **not yet wired**
**Purpose:** Generates executive and domain summaries for documents.

**Input variables:**
- `{business_name}`, `{total_cases}`, `{domain_list}`, `{output_language}`

**Expected output:** JSON array of summary objects.

---

### 16. KEYWORDS_TRANSLATE_PROMPT

**Step:** export (multi-language) — **not yet wired**
**Purpose:** Translates JSON keyword values into a target language.

**Input variables:**
- `{target_language}`, `{json_payload}`

**Expected output:** Translated JSON.

---

### 17. USE_CASE_TRANSLATE_PROMPT

**Step:** export (multi-language) — **not yet wired**
**Purpose:** Translates use case data into a target language.

**Input variables:**
- `{target_language}`, `{json_payload}`

**Expected output:** Translated JSON.

---

## Function Registries

### AI_FUNCTIONS

Used in AI use case generation prompts to guide the LLM on available Databricks
AI SQL functions:

| Function | Description |
|----------|-------------|
| ai_analyze_sentiment | Sentiment analysis on text columns |
| ai_classify | Text classification into categories |
| ai_extract | Entity extraction from text |
| ai_fix_grammar | Grammar correction |
| ai_mask | PII masking |
| ai_parse_document | Document parsing (unstructured) |
| ai_similarity | Text similarity scoring |
| ai_summarize | Text summarisation |
| ai_translate | Language translation |
| ai_query | Free-form LLM queries |
| ai_forecast | Time series forecasting |
| vector_search | Vector similarity search |

### STATISTICAL_FUNCTIONS

Used in statistical use case generation prompts:

| Category | Functions |
|----------|-----------|
| Central Tendency | AVG, MEDIAN, MODE |
| Dispersion | STDDEV_POP, STDDEV_SAMP, VAR_POP, MIN, MAX, RANGE |
| Distribution Shape | SKEWNESS, KURTOSIS |
| Percentiles | PERCENTILE_APPROX, PERCENTILE, APPROX_PERCENTILE |
| Trend Analysis | REGR_SLOPE, REGR_INTERCEPT, REGR_R2 |
| Correlation | CORR, COVAR_POP |
| Volatility | COEFF_VAR |
| Outlier Detection | Z_SCORE, IQR_THRESHOLD |
| Ranking | CUME_DIST, NTILE, DENSE_RANK, ROW_NUMBER |
| Time Series | LAG, LEAD, RUNNING_SUM, MOVING_AVG |
| OLAP | ROLLUP, CUBE, PIVOT |

---

## Shared SQL Quality Rules

**Module:** `lib/ai/sql-rules.ts`

All SQL-generating prompts share a centralised set of Databricks SQL quality
rules to ensure consistency across pipeline SQL, Genie trusted assets,
benchmarks, and dashboard queries.

### `DATABRICKS_SQL_RULES` (comprehensive)

Used by prompts that generate complete SQL queries (e.g. `USE_CASE_SQL_GEN_PROMPT`,
dashboard prompts). Covers:

- **Syntax safety**: No `MEDIAN()` (use `PERCENTILE_APPROX`), no nested
  window functions in aggregates, `DECIMAL(18,2)` for financials
- **Query structure**: `ORDER BY ... LIMIT N` for top-N (not `RANK`),
  `QUALIFY` for per-group dedup, explicit column lists, filter early
- **Databricks features**: `COLLATE UTF8_LCASE`, pipe syntax, native
  functions over UDFs

### `DATABRICKS_SQL_RULES_COMPACT` (abbreviated)

Used by Genie engine passes where context budget is tight (trusted assets,
benchmarks, metric views). Contains the most critical rules only.

---

## Infrastructure

### Versioning

Prompt templates are version-tracked via content-addressable SHA-256 hashes
computed at startup. The `PROMPT_VERSIONS` map in `lib/ai/templates.ts`
provides a `Record<PromptKey, string>` where each value is an 8-character
hash of the template content.

These hashes are stored with each pipeline run (in `generationOptions.promptVersions`)
so that any change to a prompt template is automatically traceable to specific runs.

### Prompt Injection Protection

User-supplied variables (listed in `USER_INPUT_VARIABLES`) are wrapped with
`---BEGIN USER DATA---` / `---END USER DATA---` delimiters by the
`sanitiseUserInput()` function before injection into templates.

### Variable Validation

The `formatPrompt()` function logs a warning if any `{placeholder}` patterns
remain after variable substitution, catching missing variables at runtime
instead of silently sending unresolved placeholders to the LLM.
