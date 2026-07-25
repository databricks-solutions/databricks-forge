# Release Notes -- 2026-03-12

**Databricks Forge v0.28.0**

---

## New Features

### Business Value Rerun
Added the ability to refresh business value analysis on a completed pipeline run without re-executing the entire pipeline. A new "Refresh Analysis" button on the Business Value tab clears existing estimates, roadmap phases, stakeholder profiles, and executive synthesis, then reruns the 4 LLM passes. Value tracking and value captures entered by users are preserved. Includes concurrency guards to prevent conflicts with running pipelines.

### Business Value Embeddings for Strategic Advisor
Business value outputs (value estimates, roadmap phases, stakeholder profiles, executive synthesis) are now embedded as 4 new entity kinds in the vector store. A new `strategy` search scope groups these kinds and is wired into the Strategic Advisor persona's RAG context, enabling it to answer financial, roadmap, and stakeholder questions grounded in actual pipeline data.

---

## Improvements

### Strategic Advisor Persona Modulation
The Strategic Advisor persona now supplements its base retrieval plans with the `strategy` scope when not already present, ensuring business value data is always retrieved for strategic queries regardless of detected intent.

### Business Value Nav Reorder
The sidebar navigation for Business Value has been reordered: Strategy now appears directly above Outcome Maps (previously between Roadmap and Stakeholders).

---

## Other Changes

- Added `rerun_business_value` activity action to the audit log and activity feed
- Business value embedding runs automatically at the end of both `startPipeline` and `resumePipeline`
- Added 4 text compose functions for embedding business value entities

---

## Commits (1)

| Hash | Summary |
|---|---|
| `f5b8be4` | feat: add BV rerun endpoint, embed business value data for Strategic Advisor |

**Uncommitted changes:** Version bump to 0.28.0, updated release notes.
