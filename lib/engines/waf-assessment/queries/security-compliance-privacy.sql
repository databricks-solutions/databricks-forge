-- WAF Assessment: Security, Compliance and Privacy pillar.
--
-- Evaluates a subset of SCP controls with observable signals in `system.*`
-- (audit, lakeflow.job_run_timeline, information_schema). Other SCP controls
-- (network controls, IdP federation, customer-managed keys) require admin
-- API calls or the qualitative flow and stay catalog-only here.
--
-- Returns one row per control with: waf_id, principle, description,
-- score_percentage, threshold_percentage, threshold_met.

WITH active_jobs AS (
  -- Latest snapshot of each job. system.lakeflow.job_run_timeline does not
  -- expose a `triggered_by` / `run_as` column, so SP attribution is taken
  -- from the job definition (run_as) instead of per-run.
  SELECT *
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY change_time DESC) AS rn
    FROM system.lakeflow.jobs
  ) j
  WHERE rn = 1 AND delete_time IS NULL
),
sp_runs AS (
  -- SCP-01-13: jobs configured to run as service principals
  -- (UUID-shaped run_as identifier).
  SELECT
    COUNT(*) AS total_runs,
    SUM(CASE WHEN run_as RLIKE '^[0-9a-f]{8}-[0-9a-f]{4}' THEN 1 ELSE 0 END) AS sp_runs
  FROM active_jobs
),
dbfs_tables AS (
  -- SCP-02-01: avoid storing production data in DBFS.
  -- Counts tables whose storage location is rooted at dbfs:/.
  SELECT
    COUNT(*) AS total_tables,
    SUM(CASE WHEN storage_path LIKE 'dbfs:/%' OR storage_path LIKE '/dbfs/%' THEN 1 ELSE 0 END) AS dbfs_tables
  FROM system.information_schema.tables
  WHERE table_type IN ('MANAGED', 'EXTERNAL')
),
audit_signal AS (
  -- SCP-06-01 / SCP-06-02: audit signal flowing into system tables.
  SELECT
    CASE WHEN EXISTS (
      SELECT 1 FROM system.access.audit
      WHERE event_time >= current_timestamp() - INTERVAL 7 DAYS
    ) THEN 100 ELSE 0 END AS audit_score
),
tagged_jobs AS (
  -- SCP-06-05: tagging coverage on jobs (used for charge-back / monitoring).
  SELECT
    COUNT(*) AS total_jobs,
    SUM(CASE WHEN tags IS NOT NULL AND size(tags) > 0 THEN 1 ELSE 0 END) AS jobs_with_tags
  FROM active_jobs
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    description,
    CASE
    WHEN waf_id = 'SCP-01-13' THEN (
      SELECT CASE WHEN total_runs > 0 THEN (sp_runs * 100.0 / total_runs) ELSE 0 END FROM sp_runs
    )
    WHEN waf_id = 'SCP-02-01' THEN (
      -- Score = % of tables NOT in DBFS. Higher is better.
      SELECT CASE WHEN total_tables > 0 THEN ((total_tables - dbfs_tables) * 100.0 / total_tables) ELSE 100 END FROM dbfs_tables
    )
    WHEN waf_id = 'SCP-06-01' THEN (SELECT audit_score FROM audit_signal)
    WHEN waf_id = 'SCP-06-02' THEN (SELECT audit_score FROM audit_signal)
    WHEN waf_id = 'SCP-06-05' THEN (
      SELECT CASE WHEN total_jobs > 0 THEN (jobs_with_tags * 100.0 / total_jobs) ELSE 0 END FROM tagged_jobs
    )
    ELSE 0
    END AS current_percentage
  FROM (
    SELECT * FROM VALUES
    ('SCP-01-13', 'Identity and access management', 'Use service principals to run production jobs'),
    ('SCP-02-01', 'Data protection', 'Avoid storing production data in DBFS'),
    ('SCP-06-01', 'Monitor and audit', 'Monitor workspace using System tables'),
    ('SCP-06-02', 'Monitor and audit', 'Use Databricks audit log'),
    ('SCP-06-05', 'Monitor and audit', 'Configure tagging to monitor usage and enable charge-back')
    AS waf(waf_id, principle, description)
  )
)
SELECT
  waf_id,
  principle,
  description,
  ROUND(current_percentage, 1) AS score_percentage,
  CASE
  WHEN waf_id = 'SCP-01-13' THEN 50
  WHEN waf_id = 'SCP-02-01' THEN 95
  WHEN waf_id = 'SCP-06-01' THEN 100
  WHEN waf_id = 'SCP-06-02' THEN 100
  WHEN waf_id = 'SCP-06-05' THEN 50
  END AS threshold_percentage,
  CASE
  WHEN waf_id = 'SCP-01-13' AND current_percentage >= 50 THEN 'Met'
  WHEN waf_id = 'SCP-02-01' AND current_percentage >= 95 THEN 'Met'
  WHEN waf_id = 'SCP-06-01' AND current_percentage >= 100 THEN 'Met'
  WHEN waf_id = 'SCP-06-02' AND current_percentage >= 100 THEN 'Met'
  WHEN waf_id = 'SCP-06-05' AND current_percentage >= 50 THEN 'Met'
  ELSE 'Not Met'
  END AS threshold_met
FROM waf_status
ORDER BY principle, waf_id;
