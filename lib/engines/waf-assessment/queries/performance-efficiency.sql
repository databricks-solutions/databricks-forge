WITH serverless_usage AS (
  SELECT
    COUNT(*) as total_compute,
    SUM(CASE WHEN usage_type LIKE '%SERVERLESS%' OR sku_name LIKE '%SERVERLESS%' THEN 1 ELSE 0 END) as serverless_count
  FROM system.billing.usage
  WHERE usage_date >= current_date() - INTERVAL 30 DAYS
    AND usage_type LIKE '%COMPUTE%'
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
cluster_workers AS (
  SELECT
    COUNT(*) as total_clusters,
    SUM(CASE WHEN worker_count > 1 THEN 1 ELSE 0 END) as clusters_multi_worker,
    SUM(CASE WHEN worker_count > 3 THEN 1 ELSE 0 END) as clusters_large
  FROM (
    SELECT worker_count, delete_time,
           ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS rn
    FROM system.compute.clusters
    WHERE change_time >= current_date() - INTERVAL 30 DAYS
  ) WHERE rn = 1 AND delete_time IS NULL
),
python_udfs AS (
  SELECT COUNT(*) as python_udf_count
  FROM system.information_schema.routines
  WHERE external_language = 'Python'
),
cluster_policies AS (
  SELECT
    COUNT(*) as total_clusters,
    SUM(CASE WHEN policy_id IS NOT NULL THEN 1 ELSE 0 END) as policy_clusters
  FROM (
    SELECT policy_id,
           ROW_NUMBER() OVER (PARTITION BY account_id, workspace_id, cluster_id ORDER BY change_time DESC) AS rn
    FROM system.compute.clusters
    WHERE change_time >= current_date() - INTERVAL 30 DAYS
      AND cluster_source IN ('API', 'UI')
  ) WHERE rn = 1
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    best_practice,
    CASE
    WHEN waf_id = 'PE-01-01' THEN (
      SELECT CASE WHEN total_compute > 0 THEN (serverless_count * 100.0 / total_compute) ELSE 0 END FROM serverless_usage
    )
    WHEN waf_id = 'PE-01-02' THEN (
      CASE WHEN EXISTS (SELECT 1 FROM system.billing.usage WHERE sku_name LIKE '%SERVERLESS_REAL_TIME_INFERENCE%' LIMIT 1) THEN 100 ELSE 0 END
    )
    WHEN waf_id = 'PE-02-02' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_multi_worker * 100.0 / total_clusters) ELSE 0 END FROM cluster_workers
    )
    WHEN waf_id = 'PE-02-04' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_large * 100.0 / total_clusters) ELSE 0 END FROM cluster_workers
    )
    WHEN waf_id = 'PE-02-05' THEN (
      SELECT CASE WHEN python_udf_count = 0 THEN 100 ELSE 0 END FROM python_udfs
    )
    WHEN waf_id = 'PE-02-06' THEN (
      SELECT CASE WHEN total_compute > 0 THEN (photon_compute * 100.0 / total_compute) ELSE 0 END FROM photon_usage
    )
    WHEN waf_id = 'PE-02-07' THEN (
      SELECT CASE WHEN total_clusters > 0 THEN (policy_clusters * 100.0 / total_clusters) ELSE 0 END FROM cluster_policies
    )
    ELSE 0
    END AS current_percentage,
    CASE
    WHEN waf_id = 'PE-01-01' AND (
      SELECT CASE WHEN total_compute > 0 THEN (serverless_count * 100.0 / total_compute) ELSE 0 END FROM serverless_usage
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'PE-01-02' AND EXISTS (
      SELECT 1 FROM system.billing.usage WHERE sku_name LIKE '%SERVERLESS_REAL_TIME_INFERENCE%' LIMIT 1
    ) THEN 'Yes'
    WHEN waf_id = 'PE-02-02' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_multi_worker * 100.0 / total_clusters) ELSE 0 END FROM cluster_workers
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'PE-02-04' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (clusters_large * 100.0 / total_clusters) ELSE 0 END FROM cluster_workers
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'PE-02-05' AND (
      SELECT python_udf_count FROM python_udfs
    ) = 0 THEN 'Yes'
    WHEN waf_id = 'PE-02-06' AND (
      SELECT CASE WHEN total_compute > 0 THEN (photon_compute * 100.0 / total_compute) ELSE 0 END FROM photon_usage
    ) >= 80 THEN 'Yes'
    WHEN waf_id = 'PE-02-07' AND (
      SELECT CASE WHEN total_clusters > 0 THEN (policy_clusters * 100.0 / total_clusters) ELSE 0 END FROM cluster_policies
    ) >= 50 THEN 'Yes'
    ELSE 'No'
    END AS implemented
  FROM (
    SELECT * FROM VALUES
    ('PE-01-01', 'Utilize serverless capabilities', 'Use serverless architecture'),
    ('PE-01-02', 'Utilize serverless capabilities', 'Use an enterprise grade model serving service'),
    ('PE-02-02', 'Design workloads for performance', 'Use parallel computation where it is beneficial'),
    ('PE-02-04', 'Design workloads for performance', 'Prefer larger clusters'),
    ('PE-02-05', 'Design workloads for performance', 'Use native Spark operations'),
    ('PE-02-06', 'Design workloads for performance', 'Use native platform engines'),
    ('PE-02-07', 'Design workloads for performance', 'Understand your hardware and workload type')
    AS waf(waf_id, principle, best_practice)
  )
)
SELECT
  waf_id,
  principle,
  best_practice,
  ROUND(current_percentage, 1) as score_percentage,
  CASE
  WHEN waf_id = 'PE-01-01' THEN 50
  WHEN waf_id = 'PE-01-02' THEN 100
  WHEN waf_id = 'PE-02-02' THEN 80
  WHEN waf_id = 'PE-02-04' THEN 50
  WHEN waf_id = 'PE-02-05' THEN 100
  WHEN waf_id = 'PE-02-06' THEN 80
  WHEN waf_id = 'PE-02-07' THEN 50
  END as threshold_percentage,
  CASE
  WHEN implemented = 'Yes' THEN 'Met'
  ELSE 'Not Met'
  END as threshold_met,
  implemented
FROM waf_status
ORDER BY principle, waf_id;
