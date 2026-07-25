-- WAF Assessment: Operational Excellence pillar.
--
-- Evaluates a subset of OE controls with observable signals in `system.*`
-- (lakeflow.jobs, lakeflow.pipelines, compute.warehouse_events). Remaining
-- OE controls stay catalog-only (or rely on the qualitative response flow).
--
-- Returns one row per control with: waf_id, principle, description,
-- score_percentage, threshold_percentage, threshold_met.

WITH job_population AS (
  -- Latest snapshot of each job (job edits land as new rows in lakeflow.jobs).
  SELECT *
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY change_time DESC) AS rn
    FROM system.lakeflow.jobs
  ) j
  WHERE rn = 1 AND delete_time IS NULL
),
scheduled_jobs AS (
  -- OE-02-03: jobs running on a schedule rather than ad-hoc.
  -- system.lakeflow.jobs does not expose schedule/continuous columns, so we
  -- derive scheduled vs ad-hoc from the run timeline: a job is "scheduled"
  -- if it has at least one PERIODIC or CONTINUOUS run in the last 30 days.
  SELECT
    COUNT(DISTINCT j.job_id) AS total_jobs,
    COUNT(DISTINCT CASE
      WHEN UPPER(t.trigger_type) LIKE 'PERIODIC%'
        OR UPPER(t.trigger_type) LIKE 'CONTINUOUS%'
        THEN j.job_id
    END) AS scheduled_jobs
  FROM job_population j
  LEFT JOIN system.lakeflow.job_run_timeline t
    ON t.job_id = j.job_id
   AND t.period_start_time >= current_timestamp() - INTERVAL 30 DAYS
),
declarative_pipelines AS (
  -- OE-02-05: presence of Delta Live Tables / Lakeflow Declarative Pipelines.
  SELECT
    CASE WHEN EXISTS (
      SELECT 1 FROM system.lakeflow.pipelines
      WHERE delete_time IS NULL
    ) THEN 100 ELSE 0 END AS dlt_score
),
monitoring_signal AS (
  -- OE-03-01: warehouse events flowing into system tables (ops monitoring).
  SELECT
    CASE WHEN EXISTS (
      SELECT 1 FROM system.compute.warehouse_events
      WHERE event_time >= current_timestamp() - INTERVAL 30 DAYS
    ) THEN 100 ELSE 0 END AS monitoring_score
),
tagged_jobs AS (
  -- OE-04-02: capacity / capacity-planning hygiene proxy via tag coverage on jobs.
  SELECT
    COUNT(*) AS total_jobs,
    SUM(CASE WHEN tags IS NOT NULL AND size(tags) > 0 THEN 1 ELSE 0 END) AS jobs_with_tags
  FROM job_population
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    description,
    CASE
    WHEN waf_id = 'OE-02-03' THEN (
      SELECT CASE WHEN total_jobs > 0 THEN (scheduled_jobs * 100.0 / total_jobs) ELSE 0 END FROM scheduled_jobs
    )
    WHEN waf_id = 'OE-02-05' THEN (SELECT dlt_score FROM declarative_pipelines)
    WHEN waf_id = 'OE-03-01' THEN (SELECT monitoring_score FROM monitoring_signal)
    WHEN waf_id = 'OE-04-02' THEN (
      SELECT CASE WHEN total_jobs > 0 THEN (jobs_with_tags * 100.0 / total_jobs) ELSE 0 END FROM tagged_jobs
    )
    ELSE 0
    END AS current_percentage
  FROM (
    SELECT * FROM VALUES
    ('OE-02-03', 'Automate deployments and workloads', 'Use automated workflows for jobs'),
    ('OE-02-05', 'Automate deployments and workloads', 'Use ETL frameworks for data pipelines'),
    ('OE-03-01', 'Monitor and observe systems', 'Establish monitoring processes'),
    ('OE-04-02', 'Manage capacity and quotas', 'Invest in capacity planning')
    AS waf(waf_id, principle, description)
  )
)
SELECT
  waf_id,
  principle,
  description,
  ROUND(current_percentage, 1) AS score_percentage,
  CASE
  WHEN waf_id = 'OE-02-03' THEN 50
  WHEN waf_id = 'OE-02-05' THEN 100
  WHEN waf_id = 'OE-03-01' THEN 100
  WHEN waf_id = 'OE-04-02' THEN 50
  END AS threshold_percentage,
  CASE
  WHEN waf_id = 'OE-02-03' AND current_percentage >= 50 THEN 'Met'
  WHEN waf_id = 'OE-02-05' AND current_percentage >= 100 THEN 'Met'
  WHEN waf_id = 'OE-03-01' AND current_percentage >= 100 THEN 'Met'
  WHEN waf_id = 'OE-04-02' AND current_percentage >= 50 THEN 'Met'
  ELSE 'Not Met'
  END AS threshold_met
FROM waf_status
ORDER BY principle, waf_id;
