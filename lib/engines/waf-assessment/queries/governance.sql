WITH delta_usage AS (
  SELECT
    COUNT(*) as total_tables,
    SUM(CASE WHEN data_source_format IN ('DELTA', 'ICEBERG', 'DELTASHARING') THEN 1 ELSE 0 END) as delta_tables
  FROM system.information_schema.tables
  WHERE table_catalog != 'hive_metastore'
    AND table_type IN ('MANAGED', 'EXTERNAL')
),
lineage_usage AS (
  SELECT
    COUNT(DISTINCT CONCAT(t.table_catalog, '.', t.table_schema, '.', t.table_name)) as total_tables,
    COUNT(DISTINCT CASE WHEN tl.target_table_full_name IS NOT NULL THEN CONCAT(t.table_catalog, '.', t.table_schema, '.', t.table_name) END) as lineage_tables
  FROM system.information_schema.tables t
  LEFT JOIN system.access.table_lineage tl ON CONCAT(t.table_catalog, '.', t.table_schema, '.', t.table_name) = tl.target_table_full_name
  WHERE t.table_catalog != 'hive_metastore'
    AND t.table_type IN ('MANAGED', 'EXTERNAL')
),
metadata_usage AS (
  SELECT
    COUNT(*) as total_tables,
    SUM(CASE WHEN comment IS NOT NULL THEN 1 ELSE 0 END) as tables_with_comments,
    CASE WHEN EXISTS (SELECT 1 FROM system.information_schema.table_tags)
      THEN (SELECT COUNT(*) FROM system.information_schema.tables WHERE table_catalog != 'hive_metastore' AND table_type IN ('MANAGED', 'EXTERNAL'))
      ELSE 0
    END as tables_with_tags
  FROM system.information_schema.tables t
  WHERE table_catalog != 'hive_metastore'
    AND t.table_type IN ('MANAGED', 'EXTERNAL')
),
waf_status AS (
  SELECT
    waf_id,
    principle,
    description,
    CASE
    WHEN waf_id = 'DG-01-03' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (lineage_tables * 100.0 / total_tables) ELSE 0 END FROM lineage_usage
    )
    WHEN waf_id = 'DG-01-04' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (tables_with_comments * 100.0 / total_tables) ELSE 0 END FROM metadata_usage
    )
    WHEN waf_id = 'DG-01-05' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (tables_with_tags * 100.0 / total_tables) ELSE 0 END FROM metadata_usage
    )
    WHEN waf_id = 'DG-02-01' THEN (
      CASE WHEN EXISTS (SELECT 1 FROM system.information_schema.row_filters) THEN 100 ELSE 0 END
    )
    WHEN waf_id = 'DG-02-02' THEN (
      CASE WHEN EXISTS (SELECT 1 FROM system.access.audit) THEN 100 ELSE 0 END
    )
    WHEN waf_id = 'DG-02-03' THEN (
      CASE WHEN EXISTS (
        SELECT 1 FROM system.information_schema.tables
        WHERE table_catalog = 'system' AND table_schema = 'marketplace' AND table_name = 'listing_access_events'
      ) THEN 100 ELSE 0 END
    )
    WHEN waf_id = 'DG-03-02' THEN (
      CASE WHEN EXISTS (
        SELECT 1 FROM system.information_schema.tables
        WHERE table_name LIKE '%_drift_metrics' OR table_name LIKE '%_profile_metrics'
      ) THEN 100 ELSE 0 END
    )
    WHEN waf_id = 'DG-03-03' THEN (
      SELECT CASE WHEN total_tables > 0 THEN (delta_tables * 100.0 / total_tables) ELSE 0 END FROM delta_usage
    )
    ELSE 0
    END AS current_percentage,
    CASE
    WHEN waf_id = 'DG-01-03' AND (
      SELECT CASE WHEN total_tables > 0 THEN (lineage_tables * 100.0 / total_tables) ELSE 0 END FROM lineage_usage
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'DG-01-04' AND (
      SELECT CASE WHEN total_tables > 0 THEN (tables_with_comments * 100.0 / total_tables) ELSE 0 END FROM metadata_usage
    ) >= 50 THEN 'Yes'
    WHEN waf_id = 'DG-01-05' AND EXISTS (SELECT 1 FROM system.information_schema.table_tags) THEN 'Yes'
    WHEN waf_id = 'DG-02-01' AND EXISTS (SELECT 1 FROM system.information_schema.row_filters) THEN 'Yes'
    WHEN waf_id = 'DG-02-02' AND EXISTS (SELECT 1 FROM system.access.audit) THEN 'Yes'
    WHEN waf_id = 'DG-02-03' AND EXISTS (
      SELECT 1 FROM system.information_schema.tables
      WHERE table_catalog = 'system' AND table_schema = 'marketplace' AND table_name = 'listing_access_events'
    ) THEN 'Yes'
    WHEN waf_id = 'DG-03-02' AND EXISTS (
      SELECT 1 FROM system.information_schema.tables
      WHERE table_name LIKE '%_drift_metrics' OR table_name LIKE '%_profile_metrics'
    ) THEN 'Yes'
    WHEN waf_id = 'DG-03-03' AND (
      SELECT CASE WHEN total_tables > 0 THEN (delta_tables * 100.0 / total_tables) ELSE 0 END FROM delta_usage
    ) >= 80 THEN 'Yes'
    ELSE 'No'
    END AS implemented
  FROM (
    SELECT * FROM VALUES
    ('DG-01-03', 'Unify data and AI management', 'Track data and AI lineage'),
    ('DG-01-04', 'Unify data and AI management', 'Add comments to metadata'),
    ('DG-01-05', 'Unify data and AI management', 'Enable easy data discovery'),
    ('DG-02-01', 'Unify data and AI security', 'Centralize access control (row/column level)'),
    ('DG-02-02', 'Unify data and AI security', 'Configure audit logging'),
    ('DG-02-03', 'Unify data and AI security', 'Audit data platform events'),
    ('DG-03-02', 'Establish data quality standards', 'Use data quality tools and profiling'),
    ('DG-03-03', 'Establish data quality standards', 'Enforce standardized data formats')
    AS waf(waf_id, principle, description)
  )
)
SELECT
  waf_id,
  principle,
  description,
  ROUND(current_percentage, 1) as score_percentage,
  CASE
  WHEN waf_id = 'DG-01-03' THEN 50
  WHEN waf_id = 'DG-01-04' THEN 50
  WHEN waf_id = 'DG-01-05' THEN 50
  WHEN waf_id = 'DG-02-01' THEN 100
  WHEN waf_id = 'DG-02-02' THEN 100
  WHEN waf_id = 'DG-02-03' THEN 100
  WHEN waf_id = 'DG-03-02' THEN 100
  WHEN waf_id = 'DG-03-03' THEN 80
  END as threshold_percentage,
  CASE
  WHEN implemented = 'Yes' THEN 'Met'
  ELSE 'Not Met'
  END as threshold_met,
  implemented
FROM waf_status
ORDER BY principle, waf_id;
