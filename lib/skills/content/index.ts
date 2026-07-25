/**
 * Barrel import for all static skill content modules.
 *
 * Importing this file triggers self-registration of every static skill
 * via registerSkill() calls in each module.
 *
 * The industry-enrichment module is NOT included here because it produces
 * dynamic skills built at runtime from the detected industry.
 */

import "./databricks-sql-patterns";
import "./databricks-data-modeling";
import "./databricks-ai-functions";
import "./databricks-sql-scripting";
import "./databricks-dashboard-sql";
import "./genie-design";
import "./metric-view-patterns";
import "./system-tables";
