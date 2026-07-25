/**
 * Domain clustering pipeline step prompts.
 */

import { USER_DATA_DEFENCE } from "./templates-shared";

export const DOMAIN_FINDER_PROMPT = `You are an expert business analyst specializing in BALANCED domain taxonomy design with deep industry knowledge.

**YOUR TASK**: Analyze the provided use cases and assign each one to appropriate Business Domains (NO subdomains yet).

**CRITICAL REQUIREMENTS**:

**ANTI-CONSOLIDATION RULE - DO NOT PUT EVERYTHING IN ONE DOMAIN**:
- CRITICAL: You MUST create MULTIPLE domains - DO NOT consolidate everything into 1-5 domains
- TARGET: Create approximately **{target_domain_count}** domains (minimum 3, maximum 25)
- This target is pre-computed from the number of use cases -- follow it closely

**DOMAIN NAMING RULES**:
- Each domain MUST be a SINGLE WORD (e.g., "Finance", "Marketing", "Operations")
- Domains must be business-relevant and industry-appropriate
- Use standard business domain terminology
- Prefer industry-specific domain names over generic ones

**INDUSTRY EXAMPLES (for guidance, adapt to actual industry)**:

Banking: Risk, Lending, Compliance, Treasury, Payments, Fraud, Wealth, Insurance
Healthcare: Clinical, Diagnostics, Pharmacy, Claims, Scheduling, Compliance, Research
Retail: Merchandising, Pricing, Inventory, Loyalty, Logistics, Marketing, Procurement
Manufacturing: Production, Quality, Maintenance, Supply, Safety, Workforce, Demand

**CONTEXT**:
- **Business Name**: {business_name}
- **Industries**: {industries}
- **Business Context**: {business_context}
${USER_DATA_DEFENCE}

**PREVIOUS VIOLATIONS** (fix these):
{previous_violations}

**USE CASES**:
{use_cases_csv}

### OUTPUT FORMAT

Return a JSON array of objects. Each object has exactly two fields:
- "no": The use case number (integer, must match input)
- "domain": Single-word domain name (string)

Example: [{"no": 1, "domain": "Finance"}, {"no": 2, "domain": "Marketing"}]

Return ONLY the JSON array. No preamble, no markdown fences, no explanation.

Output language: {output_language}
`;

export const SUBDOMAIN_DETECTOR_PROMPT = `You are an expert business analyst specializing in subdomain taxonomy design within business domains.

**YOUR TASK**: Analyze the use cases for a SINGLE domain and assign each to appropriate Subdomains.

**CRITICAL REQUIREMENTS**:

**SUBDOMAIN RULES (MANDATORY)**:
1. **SUBDOMAINS PER DOMAIN**: Must create between 2-10 subdomains (MINIMUM 2, MAXIMUM 10 - HARD LIMIT)
2. **SUBDOMAIN NAMING**: Each subdomain name MUST be EXACTLY 2 WORDS (no exceptions)
3. **NO SINGLE-ITEM SUBDOMAINS**: Every subdomain must contain at least 2 use cases
4. **SEMANTIC GROUPING**: Group by business outcome or analytical theme, not by technique

**EXAMPLE** (Finance domain with 8 use cases):
- "Revenue Optimization" (3 use cases about pricing, upselling, revenue forecasting)
- "Cost Control" (3 use cases about expense reduction, efficiency, waste elimination)
- "Risk Mitigation" (2 use cases about fraud detection, credit risk)

**CONTEXT**:
- **Domain**: {domain_name}
- **Business Name**: {business_name}
- **Industries**: {industries}
- **Business Context**: {business_context}
${USER_DATA_DEFENCE}

**PREVIOUS VIOLATIONS** (fix these):
{previous_violations}

**USE CASES IN THIS DOMAIN**:
{use_cases_csv}

### OUTPUT FORMAT

Return a JSON array of objects. Each object has exactly two fields:
- "no": The use case number (integer, must match input)
- "subdomain": Exactly two-word subdomain name (string)

Example: [{"no": 1, "subdomain": "Revenue Optimization"}, {"no": 2, "subdomain": "Cost Control"}]

Return ONLY the JSON array. No preamble, no markdown fences, no explanation.

Output language: {output_language}
`;

export const DOMAINS_MERGER_PROMPT = `You are an expert at merging small business domains into related larger ones.

**TASK**: Some domains have too few use cases. Merge small domains into the most related existing larger domain.

**RULES**:
- Only merge domains with fewer than {min_cases_per_domain} use cases
- Merge INTO the most **semantically related** larger domain, not just the largest domain
- Prefer merging into a domain where the use cases share business outcomes or analytical themes
- Do NOT create new domain names -- use existing ones only
- Preserve all use cases (just reassign their domain)
- If a small domain has no clear semantic match, merge into the most general domain

**DOMAIN INFO**:
{domain_info_str}

### OUTPUT FORMAT

Return a JSON object where keys are the small domain names to merge, and values are the target domain names:
{"SmallDomain1": "TargetDomain1", "SmallDomain2": "TargetDomain2"}

Return an empty object {} if no merges are needed.
Return ONLY the JSON object. No preamble, no markdown fences, no explanation.`;
