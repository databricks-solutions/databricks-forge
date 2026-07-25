# Release Notes -- 2026-03-18

**Databricks Forge v0.38.1 → v0.38.2**

---

## v0.38.1 -- Fix runs page not showing runs for any user

### Bug Fixes
- **Runs page empty for all users due to user-scoping mismatch** -- The `/runs` page and `GET /api/runs` filtered results by `createdBy` (the current user's email from `x-forwarded-email`), but the Databricks Apps proxy does not consistently set this header, causing a mismatch between the email stored at run creation time and the email resolved at listing time. Neither user could see their own runs, while the dashboard's "Recent Runs" (which had no filter) displayed them correctly. Removed the user-scoping filter so the runs page now shows all runs from all users, matching the dashboard behaviour. The `createdBy` field is still recorded on new runs for audit purposes.

---

## v0.38.2 -- Fix missing dashboard action button in Ask Forge

### Bug Fixes
- **Dashboard action suppressed by Genie mutual exclusion** -- The `buildActions()` function in the Ask Forge assistant engine had a `!genieAction` guard that prevented the "Deploy as Dashboard" button from appearing whenever a "Create Genie Space" action was also built. Since Genie actions are created when 2+ tables are referenced (common in dashboard responses), the dashboard button was effectively always hidden. Removed the mutual exclusion so both actions coexist.
- **Dashboard action fails when LLM omits backtick-wrapped FQNs** -- `extractDashboardIntent()` only extracted table names from backtick-wrapped fully-qualified names. When the LLM wrote FQNs without backticks, the proposal had zero tables and the action was silently dropped. The dashboard action now falls back to the broader `tables` array from the table extraction pipeline.

### Improvements
- **Dashboard action promoted on dashboard intent** -- The "Deploy as Dashboard" action is now promoted to the first position when the classified intent is `"dashboard"`, not just for the `"analyst"` persona.

---

## All Commits

| Hash | Summary |
|---|---|
| `ad9bcac` | fix: remove user-scoping from /runs page so all users see all runs |
