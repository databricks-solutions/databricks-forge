/**
 * Lakeview (`.lvdash.json`) source for the WAF Assessment dashboard.
 *
 * The dashboard was hand-tuned in the Databricks Lakeview editor (Genie code)
 * and exported as `template.lvdash.json`. This module just serves that JSON
 * as the `serialized_dashboard` payload — Lakeview executes its embedded
 * SQL directly against `system.*` tables, so no runtime mutation is needed.
 */
import { PILLAR_LABEL, WAF_PILLARS_WITH_QUERIES } from "../types";
import template from "./template.lvdash.json";

export const WAF_DASHBOARD_DISPLAY_NAME = "Forge WAF Assessment";

export async function buildWafDashboardJson(): Promise<string> {
  return JSON.stringify(template);
}

export { PILLAR_LABEL, WAF_PILLARS_WITH_QUERIES };
