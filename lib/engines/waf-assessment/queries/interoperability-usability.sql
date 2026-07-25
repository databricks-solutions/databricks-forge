-- WAF Assessment: Interoperability and Usability pillar.
--
-- Evaluates a subset of IU controls that have observable signals in
-- `system.*`. Other IU controls remain catalog-only (no automatic check yet)
-- and are excluded from the pillar score.
--
-- Returns one row per control with: waf_id, principle, description,
-- score_percentage, threshold_percentage, threshold_met.

WITH delta_usage AS (
  SELECT
    COUNT(*) AS total_tables,
    SUM(CASE WHEN data_source_format IN ('DELTA', 'ICEBERG', 'DELTASHARING') THEN 1 ELSE 0 END) AS delta_tables
  FROM system.information_schema.tables
  WHERE table_catalog != 'hive_metastore'
    AND table_type IN ('MANAGED', 'EXTERNAL')
),
uc_adoption AS (
  -- Unity Catalog adoption: fraction of catalogs/tables that are NOT in hive_metastore.
  -- A central catalog (UC) is the prerequisite for IU-04-03.
  SELECT
    COUNT(*) AS total_tables,
    SUM(CASE WHEN table_catalog != 'hive_metastore' THEN 1 ELSE 0 END) AS uc_tables
  FROM system.information_schema.tables
  WHERE table_type IN ('MANAGED', 'EXTERNAL')
),
serverless_compute AS (
  -- Fraction of SQL warehouses on the Pro tier (serverless-capable).
  -- system.compute.warehouses no longer exposes an explicit
  -- `enable_serverless_compute` column, so we treat warehouse_type='PRO'
  -- as the proxy for modern / serverless-capable compute.
  SELECT
    COUNT(*) AS total_warehouses,
    SUM(CASE WHEN warehouse_type = 'PRO' THEN 1 ELSE 0 END) AS serverless_warehouses
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY change_time DESC) AS rn
    FROM system.compute.warehouses
  ) w
  WHERE rn = 1 AND delete_time IS NULL
),
sharing_enabled AS (
  -- Delta Sharing surface presence. We use the catalog metadata check rather
  -- than counting actual shares because share counts are workspace-private.
  SELECT
    CASE WHEN EXISTS (
      SELECT 1 FROM system.information_schema.tables
      WHERE data_source_format = 'DELTASHARING'
    ) THEN 100 ELSE 0 END AS share_score
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    description,
    CASE
    WHEN waf_id = 'IU-02-01' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (delta_tables * 100.0 / total_tables) ELSE 0 END FROM delta_usage
    )
    WHEN waf_id = 'IU-02-02' THEN (SELECT share_score FROM sharing_enabled)
    WHEN waf_id = 'IU-03-02' THEN (
      SELECT CASE WHEN total_warehouses > 0 THEN (serverless_warehouses * 100.0 / total_warehouses) ELSE 0 END FROM serverless_compute
    )
    WHEN waf_id = 'IU-04-03' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (uc_tables * 100.0 / total_tables) ELSE 0 END FROM uc_adoption
    )
    ELSE 0
    END AS current_percentage
  FROM (
    SELECT * FROM VALUES
    ('IU-02-01', 'Use open standards to support interoperability', 'Use open data formats'),
    ('IU-02-02', 'Use open standards to support interoperability', 'Enable secure data sharing'),
    ('IU-03-02', 'Enable a self-service experience', 'Use serverless services'),
    ('IU-04-03', 'Treat data as a product', 'Provide a central catalog for discovery and lineage')
    AS waf(waf_id, principle, description)
  )
)
SELECT
  waf_id,
  principle,
  description,
  ROUND(current_percentage, 1) AS score_percentage,
  CASE
  WHEN waf_id = 'IU-02-01' THEN 80
  WHEN waf_id = 'IU-02-02' THEN 100
  WHEN waf_id = 'IU-03-02' THEN 50
  WHEN waf_id = 'IU-04-03' THEN 90
  END AS threshold_percentage,
  CASE
  WHEN waf_id = 'IU-02-01' AND current_percentage >= 80 THEN 'Met'
  WHEN waf_id = 'IU-02-02' AND current_percentage >= 100 THEN 'Met'
  WHEN waf_id = 'IU-03-02' AND current_percentage >= 50 THEN 'Met'
  WHEN waf_id = 'IU-04-03' AND current_percentage >= 90 THEN 'Met'
  ELSE 'Not Met'
  END AS threshold_met
FROM waf_status
ORDER BY principle, waf_id;
