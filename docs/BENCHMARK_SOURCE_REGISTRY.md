# Benchmark Source Registry

## Source Policy

- Public and licensing-safe sources only.
- Benchmark records must include provenance metadata and a verifiable URL.
- Any source not in the approved classes is rejected during ingestion.

## Approved Source Classes

- Regulators (`regulator`)
- Standards bodies (`standards_body`)
- Public datasets (`public_dataset`)
- Databricks documentation (`databricks_doc`)
- Open reports (`open_report`)
- Academic/public research (`academic`)

## Required Record Metadata

- `source_type`, `source_url`, `publisher`, `published_at`
- `industry`, `region`
- `metric_definition` or `methodology_note` where applicable
- `license_class`, `confidence`, `ttl_days`

## Lifecycle Workflow

- `draft` -> `reviewed` -> `published` -> `deprecated`
- Only published records are used in benchmark context retrieval.
- Deprecated records remain for audit history and are excluded from prompts.

## Review Checklist

- URL is public and reachable.
- Source publisher is reputable and aligned to source policy.
- Content is summarized/paraphrased (no proprietary copy-paste).
- Claim is not represented as customer fact.
- Freshness window (`ttl_days`) is appropriate for source volatility.
