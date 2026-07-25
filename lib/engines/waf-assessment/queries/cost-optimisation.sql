WITH managed_usage AS (
  SELECT
    TRY_DIVIDE(
      100.0 * SUM(CASE WHEN table_type = 'MANAGED' THEN 1 ELSE 0 END),
      SUM(CASE WHEN table_type IN ('MANAGED', 'EXTERNAL') THEN 1 ELSE 0 END)
    ) AS managed_percentage
  FROM system.information_schema.tables
  WHERE table_catalog != 'hive_metastore'
),
serverless_usage AS (
  SELECT
    COUNT(*) as total_compute,
    SUM(CASE
          WHEN UPPER(sku_name) LIKE '%SERVERLESS%'
            OR UPPER(usage_type) LIKE '%SERVERLESS%'
          THEN 1 ELSE 0
        END) as serverless_count
  FROM system.billing.usage
  WHERE usage_date >= current_date() - INTERVAL 30 DAYS
    AND usage_type IN ('COMPUTE_TIME', 'GPU_TIME')
),
photon_usage AS (
  SELECT
    COUNT(*) as total_compute,
    SUM(CASE WHEN product_features.is_photon = true THEN 1 ELSE 0 END) as photon_compute
  FROM system.billing.usage
  WHERE usage_date >= current_date() - INTERVAL 30 DAYS
    AND usage_type LIKE '%COMPUTE%'
    AND billing_origin_product IN ('JOBS', 'INTERACTIVE', 'PIPELINES', 'ALL_PURPOSE')
),
sql_warehouse_usage AS (
  SELECT
    COUNT(*) as total_compute,
    SUM(CASE WHEN compute.type = 'WAREHOUSE' THEN 1 ELSE 0 END) as sql_compute
  FROM system.query.history
  WHERE start_time >= current_timestamp() - INTERVAL 30 DAYS
),
cluster_policies AS (
  SELECT
    COUNT(*) as total_clusters,
    SUM(CASE WHEN policy_id IS NOT NULL THEN 1 ELSE 0 END) as clusters_with_policy
  FROM (
    SELECT policy_id, delete_time,
           ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS rn
    FROM system.compute.clusters
  ) WHERE rn = 1 AND delete_time IS NULL
),
cluster_tags AS (
  SELECT
    COUNT(*) as total_clusters,
    SUM(CASE WHEN size(map_keys(tags)) > 0 THEN 1 ELSE 0 END) as clusters_with_tags
  FROM (
    SELECT tags, delete_time,
           ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS rn
    FROM system.compute.clusters
    WHERE change_time >= current_date() - INTERVAL 30 DAYS
  ) WHERE rn = 1 AND delete_time IS NULL
),
runtime_versions AS (
  SELECT
    COUNT(*) AS total_clusters,
    SUM(CASE WHEN TRY_CAST(split(regexp_replace(dbr_version, 'dlt:', ''), '[.]')[0] AS INT) >= 15 THEN 1 ELSE 0 END) AS up_to_date_clusters
  FROM (
    SELECT dbr_version, delete_time,
           ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS rn
    FROM system.compute.clusters
  ) WHERE rn = 1 AND delete_time IS NULL AND dbr_version IS NOT NULL
),billing_monitoring AS (
  SELECT
    COUNT(DISTINCT DATE(start_time)) AS active_days_last_30
  FROM system.query.history
  WHERE start_time >= current_timestamp() - INTERVAL 30 DAYS
    AND LOWER(statement_text) RLIKE 'system\.billing\.(usage|list_prices)'
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    best_practice,
    CASE
    WHEN waf_id = 'CO-01-01' THEN (
      SELECT managed_percentage FROM managed_usage
    )
    WHEN waf_id = 'CO-01-03' THEN (
      SELECT CASE WHEN total_compute > 0 THEN (sql_compute * 100.0 / total_compute) ELSE 0 END FROM sql_warehouse_usage
    )
    WHEN waf_id = 'CO-01-04' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (up_to_date_clusters * 100.0 / total_clusters) ELSE 0 END FROM runtime_versions
    )
    WHEN waf_id = 'CO-01-06' THEN (
      SELECT CASE WHEN total_compute > 0 THEN (serverless_count * 100.0 / total_compute) ELSE 0 END FROM serverless_usage
    )
    WHEN waf_id = 'CO-01-09' THEN (
      SELECT CASE WHEN total_compute > 0 THEN (photon_compute * 100.0 / total_compute) ELSE 0 END FROM photon_usage
    )
    WHEN waf_id = 'CO-02-03' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_with_policy * 100.0 / total_clusters) ELSE 0 END FROM cluster_policies
    )
    WHEN waf_id = 'CO-03-01' THEN (
      SELECT active_days_last_30 FROM billing_monitoring
    )
    WHEN waf_id = 'CO-03-02' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_with_tags * 100.0 / total_clusters) ELSE 0 END FROM cluster_tags
    )
    ELSE 0
    END AS current_percentage,
    CASE
    WHEN waf_id = 'CO-01-01' AND (
      SELECT managed_percentage FROM managed_usage
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'CO-01-03' AND (
      SELECT CASE WHEN total_compute > 0 THEN (sql_compute * 100.0 / total_compute) ELSE 0 END FROM sql_warehouse_usage
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'CO-01-04' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (up_to_date_clusters * 100.0 / total_clusters) ELSE 0 END FROM runtime_versions
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'CO-01-06' AND (
      SELECT CASE WHEN total_compute > 0 THEN (serverless_count * 100.0 / total_compute) ELSE 0 END FROM serverless_usage
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'CO-01-09' AND (
      SELECT CASE WHEN total_compute > 0 THEN (photon_compute * 100.0 / total_compute) ELSE 0 END FROM photon_usage
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'CO-02-03' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_with_policy * 100.0 / total_clusters) ELSE 0 END FROM cluster_policies
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'CO-03-01' AND (
      SELECT active_days_last_30 FROM billing_monitoring
    ) >= 10 THEN 'Yes'
    WHEN waf_id = 'CO-03-02' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_with_tags * 100.0 / total_clusters) ELSE 0 END FROM cluster_tags
    ) >= 80 THEN 'Yes'
    ELSE 'No'
    END AS implemented
  FROM (
    SELECT * FROM VALUES
    ('CO-01-01', 'Choose optimal resources', 'Prefer Managed table type over External tables'),
    ('CO-01-03', 'Choose optimal resources', 'Use SQL warehouse for SQL workloads'),
    ('CO-01-04', 'Choose optimal resources', 'Use up-to-date runtimes'),
    ('CO-01-06', 'Choose optimal resources', 'Use Serverless for your workloads'),
    ('CO-01-09', 'Choose optimal resources', 'Evaluate performance optimized query engines'),
    ('CO-02-03', 'Dynamically allocate resources', 'Use compute policies to control costs'),
    ('CO-03-01', 'Monitor and control cost', 'Monitor costs'),
    ('CO-03-02', 'Monitor and control cost', 'Tag clusters for cost attribution')
    AS waf(waf_id, principle, best_practice)
  )
)
SELECT
  waf_id,
  principle,
  best_practice,
  ROUND(current_percentage, 1) as score_percentage,
  CASE
  WHEN waf_id = 'CO-01-01' THEN 80
  WHEN waf_id = 'CO-01-03' THEN 50
  WHEN waf_id = 'CO-01-04' THEN 80
  WHEN waf_id = 'CO-01-06' THEN 50
  WHEN waf_id = 'CO-01-09' THEN 80
  WHEN waf_id = 'CO-02-03' THEN 80
  WHEN waf_id = 'CO-03-01' THEN 10
  WHEN waf_id = 'CO-03-02' THEN 80
  END as threshold_percentage,
  CASE
  WHEN implemented = 'Yes' THEN 'Met'
  ELSE 'Not Met'
  END as threshold_met,
  implemented
FROM waf_status
ORDER BY principle, waf_id;
