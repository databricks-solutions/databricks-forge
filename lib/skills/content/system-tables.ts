/**
 * System Tables skill.
 *
 * Distilled from:
 *   - External databricks-unity-catalog skill (5-system-tables.md, SKILL.md)
 *   - system.lakeflow, system.storage, system.compute extensions
 *
 * Covers system table catalog, query patterns, governance templates,
 * jobs/pipelines monitoring, storage/compute metrics, and observability.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const SYSTEM_TABLE_CATALOG = `Databricks System Table Catalog:
- system.access.audit: Audit log events (who did what, when). Partition key: event_date.
  Key columns: event_date, event_time, user_identity.email, action_name, request_params, service_name, source_ip_address
- system.access.table_lineage: Table-level lineage edges. Partition key: event_date.
  Key columns: source_table_full_name, target_table_full_name, source_type, target_type, event_date
- system.access.column_lineage: Column-level lineage. Partition key: event_date.
  Key columns: source_table_full_name, source_column_name, target_table_full_name, target_column_name
- system.billing.usage: DBU consumption. Partition key: usage_date.
  Key columns: usage_date, workspace_id, sku_name, usage_quantity, usage_unit
- system.compute.clusters: Cluster inventory and configuration.
  Key columns: cluster_id, cluster_name, cluster_source, state, driver_node_type, num_workers
- system.compute.warehouses: SQL warehouse inventory and configuration.
  Key columns: warehouse_id, warehouse_name, warehouse_type, cluster_size, state
- system.query.history: SQL query history. Partition key: execution_start_time_utc.
  Key columns: statement_id, executed_by, statement_text, status, duration, rows_produced, warehouse_id
- system.lakeflow.jobs: Job definitions and configuration.
  Key columns: job_id, name, creator_user_name, run_as_user_name, settings
- system.lakeflow.job_run_timeline: Job run history and timeline.
  Key columns: job_id, run_id, result_state, start_time, end_time, execution_duration
- system.storage.predictive_optimization_operations_history: Auto OPTIMIZE/VACUUM history.
  Key columns: table_name, operation_type, operation_status, start_time, metrics`;

const QUERY_PATTERNS = `System Table Query Patterns:
- ALWAYS filter by the partition key (event_date, usage_date, or execution_start_time_utc) to avoid full scans
- Lineage queries: SELECT source_table_full_name, target_table_full_name FROM system.access.table_lineage WHERE event_date >= current_date() - INTERVAL 30 DAY
- Audit queries: Filter by action_name (e.g. 'createTable', 'deleteTable', 'grantPermission') and user_identity.email
- Billing queries: GROUP BY sku_name, usage_date for cost trend analysis; JOIN with workspace metadata for allocation
- Query history: Filter by status ('FINISHED', 'FAILED'), use duration for performance analysis, warehouse_id for warehouse utilization
- Access pattern analysis: COUNT queries per table from query.history to identify hot/cold tables`;

const GOVERNANCE_PATTERNS = `Governance SQL Patterns:
- Grant minimal access: GRANT USE CATALOG ON CATALOG system TO group_name; GRANT USE SCHEMA, SELECT on specific schemas
- Audit trail: SELECT event_time, user_identity.email, action_name, request_params FROM system.access.audit WHERE event_date >= current_date() - INTERVAL 7 DAY AND action_name IN ('createTable', 'deleteTable')
- Data freshness: Use table_lineage event_date to detect stale pipelines (no writes in N days)
- Unused tables: Cross-reference table inventory with query.history to find tables with zero reads`;

const JOBS_PIPELINES = `Jobs & Pipeline Monitoring Patterns:
- Job failure rate: SELECT job_id, name, COUNT_IF(result_state = 'FAILED') / COUNT(*) AS failure_rate FROM system.lakeflow.job_run_timeline WHERE start_time >= current_date() - INTERVAL 30 DAY GROUP BY 1, 2
- Pipeline SLA: SELECT job_id, PERCENTILE_APPROX(execution_duration, 0.95) AS p95_duration FROM system.lakeflow.job_run_timeline GROUP BY 1
- Long-running jobs: SELECT * FROM system.lakeflow.job_run_timeline WHERE execution_duration > INTERVAL 2 HOUR AND start_time >= current_date() - INTERVAL 7 DAY
- Job concurrency: COUNT active runs per hour to identify scheduling bottlenecks`;

const STORAGE_COMPUTE = `Storage & Compute Monitoring Patterns:
- Warehouse utilization: SELECT warehouse_id, warehouse_name, AVG(num_clusters) AS avg_clusters FROM system.compute.warehouses GROUP BY 1, 2
- Predictive optimization: SELECT table_name, operation_type, COUNT(*) AS ops, MAX(start_time) AS last_run FROM system.storage.predictive_optimization_operations_history GROUP BY 1, 2
- Cost allocation by team: JOIN system.billing.usage with workspace metadata (tags) to attribute DBU costs to teams
- Warehouse sizing: Compare query.history duration percentiles across warehouse sizes to right-size`;

const OBSERVABILITY = `Data Product Observability Patterns:
- Freshness SLA monitoring: Use table_lineage event_date to detect tables with no writes in N days; alert when SLA breached
- Unused table detection: Cross-reference information_schema table inventory with query.history to find tables with zero reads in 90 days
- Query performance: SELECT warehouse_id, PERCENTILE_APPROX(duration, 0.5) AS p50, PERCENTILE_APPROX(duration, 0.9) AS p90, PERCENTILE_APPROX(duration, 0.99) AS p99 FROM system.query.history WHERE execution_start_time_utc >= current_date() - INTERVAL 7 DAY GROUP BY 1
- Hot table detection: SELECT statement_text patterns to identify most-queried tables
- Error rate tracking: COUNT_IF(status = 'FAILED') / COUNT(*) from query.history grouped by warehouse and day`;

const skill: SkillDefinition = {
  id: "system-tables",
  name: "Databricks System Tables",
  description:
    "System table catalog (audit, lineage, billing, compute, query history, " +
    "jobs, storage), query patterns, governance templates, and observability recipes.",
  relevance: {
    intents: ["technical", "exploration", "business"],
  },
  chunks: [
    {
      id: "systbl-catalog",
      title: "System Table Catalog",
      content: SYSTEM_TABLE_CATALOG,
      category: "vocabulary",
    },
    {
      id: "systbl-query-patterns",
      title: "System Table Query Patterns",
      content: QUERY_PATTERNS,
      category: "patterns",
    },
    {
      id: "systbl-governance",
      title: "Governance Patterns",
      content: GOVERNANCE_PATTERNS,
      category: "patterns",
    },
    {
      id: "systbl-jobs-pipelines",
      title: "Jobs & Pipeline Monitoring",
      content: JOBS_PIPELINES,
      category: "patterns",
    },
    {
      id: "systbl-storage-compute",
      title: "Storage & Compute Monitoring",
      content: STORAGE_COMPUTE,
      category: "patterns",
    },
    {
      id: "systbl-observability",
      title: "Data Product Observability",
      content: OBSERVABILITY,
      category: "patterns",
    },
  ],
};

registerSkill(skill);

export default skill;
