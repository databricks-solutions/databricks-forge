/**
 * DDL generation for Meta Data Genie curated views.
 *
 * Generates CREATE OR REPLACE VIEW statements that select curated columns
 * from system.information_schema, with optional catalog scope filtering.
 */

import { validateIdentifier, validateFqn } from "@/lib/validation";
import type { ViewTarget } from "./types";

// ---------------------------------------------------------------------------
// View Definitions
// ---------------------------------------------------------------------------

interface ViewDef {
  name: string;
  source: string;
  columns: string[];
  /** Column used for catalog-level filtering (e.g. table_catalog, catalog_name). */
  filterColumn: string;
  /** Column used for schema-level filtering, if applicable. */
  schemaColumn?: string;
  /** Column containing the table name, used to exclude underscore-prefixed artefacts. */
  tableNameColumn?: string;
  comment: string;
}

/** Catalogs excluded from all views -- system internals and sample datasets. */
const EXCLUDED_CATALOGS = ["system", "__databricks_internal", "samples", "hive_metastore"];

/** Schemas excluded from views that have a schema column. */
const EXCLUDED_SCHEMAS = ["information_schema"];

const VIEW_DEFS: ViewDef[] = [
  {
    name: "mdg_catalogs",
    source: "system.information_schema.catalogs",
    columns: [
      "catalog_name",
      "catalog_owner",
      "comment",
      "created",
      "created_by",
      "last_altered",
      "last_altered_by",
    ],
    filterColumn: "catalog_name",
    comment: "Curated metadata view: catalogs in the data estate",
  },
  {
    name: "mdg_schemas",
    source: "system.information_schema.schemata",
    columns: [
      "catalog_name",
      "schema_name",
      "schema_owner",
      "comment",
      "created",
      "created_by",
      "last_altered",
      "last_altered_by",
    ],
    filterColumn: "catalog_name",
    schemaColumn: "schema_name",
    comment: "Curated metadata view: schemas in the data estate",
  },
  {
    name: "mdg_tables",
    source: "system.information_schema.tables",
    columns: [
      "table_catalog",
      "table_schema",
      "table_name",
      "table_type",
      "table_owner",
      "comment",
      "data_source_format",
      "created",
      "created_by",
      "last_altered",
      "last_altered_by",
    ],
    filterColumn: "table_catalog",
    schemaColumn: "table_schema",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: tables and views in the data estate",
  },
  {
    name: "mdg_columns",
    source: "system.information_schema.columns",
    columns: [
      "table_catalog",
      "table_schema",
      "table_name",
      "column_name",
      "ordinal_position",
      "data_type",
      "is_nullable",
      "comment",
    ],
    filterColumn: "table_catalog",
    schemaColumn: "table_schema",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: column definitions including types and descriptions",
  },
  {
    name: "mdg_views",
    source: "system.information_schema.views",
    columns: ["table_catalog", "table_schema", "table_name", "view_definition"],
    filterColumn: "table_catalog",
    schemaColumn: "table_schema",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: view definitions and their SQL",
  },
  {
    name: "mdg_volumes",
    source: "system.information_schema.volumes",
    columns: [
      "volume_catalog",
      "volume_schema",
      "volume_name",
      "volume_type",
      "volume_owner",
      "comment",
      "storage_location",
      "created",
      "created_by",
      "last_altered",
      "last_altered_by",
    ],
    filterColumn: "volume_catalog",
    schemaColumn: "volume_schema",
    comment: "Curated metadata view: Unity Catalog volumes",
  },
  {
    name: "mdg_table_tags",
    source: "system.information_schema.table_tags",
    columns: ["catalog_name", "schema_name", "table_name", "tag_name", "tag_value"],
    filterColumn: "catalog_name",
    schemaColumn: "schema_name",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: tags applied to tables",
  },
  {
    name: "mdg_column_tags",
    source: "system.information_schema.column_tags",
    columns: ["catalog_name", "schema_name", "table_name", "column_name", "tag_name", "tag_value"],
    filterColumn: "catalog_name",
    schemaColumn: "schema_name",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: tags applied to columns",
  },
  {
    name: "mdg_table_constraints",
    source: "system.information_schema.table_constraints",
    columns: [
      "constraint_catalog",
      "constraint_schema",
      "constraint_name",
      "table_catalog",
      "table_schema",
      "table_name",
      "constraint_type",
      "enforced",
    ],
    filterColumn: "table_catalog",
    schemaColumn: "table_schema",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: primary key and foreign key constraints",
  },
  {
    name: "mdg_table_privileges",
    source: "system.information_schema.table_privileges",
    columns: [
      "table_catalog",
      "table_schema",
      "table_name",
      "grantee",
      "privilege_type",
      "is_grantable",
    ],
    filterColumn: "table_catalog",
    schemaColumn: "table_schema",
    tableNameColumn: "table_name",
    comment: "Curated metadata view: table access privileges and grants",
  },
];

// ---------------------------------------------------------------------------
// Lineage View (conditional -- only when system.access.table_lineage is accessible)
// ---------------------------------------------------------------------------

const LINEAGE_VIEW_DEF: ViewDef = {
  name: "mdg_lineage",
  source: "system.access.table_lineage",
  columns: [
    "source_table_full_name",
    "source_type",
    "target_table_full_name",
    "target_type",
    "entity_type",
    "event_time",
  ],
  filterColumn: "",
  comment: "Curated metadata view: data lineage showing upstream and downstream dependencies",
};

// ---------------------------------------------------------------------------
// DDL Generation
// ---------------------------------------------------------------------------

/** Escape single quotes for SQL string literals. */
function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Build a VALUES CTE from AI-generated descriptions for a given view.
 * Returns null if no descriptions match the view.
 */
function buildDescriptionsCTE(
  viewName: string,
  aiDescriptions: Record<string, string>,
): string | null {
  if (viewName !== "mdg_tables") return null;

  const entries = Object.entries(aiDescriptions);
  if (entries.length === 0) return null;

  const rows = entries
    .map(([fqn, desc]) => {
      const parts = fqn.split(".");
      if (parts.length !== 3) return null;
      return `('${sqlEscape(parts[0])}', '${sqlEscape(parts[1])}', '${sqlEscape(parts[2])}', '${sqlEscape(desc)}')`;
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return `ai_descs AS (\n  SELECT * FROM VALUES\n    ${rows.join(",\n    ")}\n  AS t(table_catalog, table_schema, table_name, ai_description)\n)`;
}

/**
 * Generate CREATE OR REPLACE VIEW DDL for all 10 curated views.
 *
 * When catalogScope is provided, each view includes a WHERE clause
 * filtering to only those catalogs.
 *
 * When aiDescriptions is provided, the mdg_tables view is augmented
 * with a VALUES CTE that LEFT JOINs AI-generated descriptions as an
 * `ai_comment` column.
 */
export function generateViewDDL(opts: {
  target: ViewTarget;
  catalogScope?: string[];
  aiDescriptions?: Record<string, string>;
  lineageAccessible?: boolean;
  resourcePrefix?: string;
}): string[] {
  const { target, catalogScope, aiDescriptions, lineageAccessible, resourcePrefix } = opts;
  const safeCatalog = validateIdentifier(target.catalog, "viewTarget.catalog");
  const safeSchema = validateIdentifier(target.schema, "viewTarget.schema");
  const fqnPrefix = `\`${safeCatalog}\`.\`${safeSchema}\``;

  const defs = lineageAccessible ? [...VIEW_DEFS, LINEAGE_VIEW_DEF] : VIEW_DEFS;

  return defs.map((def) => {
    const viewName =
      resourcePrefix && !def.name.startsWith(resourcePrefix)
        ? `${resourcePrefix}${def.name}`
        : def.name;
    const conditions: string[] = [];

    if (def.filterColumn) {
      if (catalogScope && catalogScope.length > 0) {
        const safeCatalogs = catalogScope.map((c) => validateIdentifier(c, "catalogScope"));
        const inList = safeCatalogs.map((c) => `'${c}'`).join(", ");
        conditions.push(`${def.filterColumn} IN (${inList})`);
      } else {
        const exList = EXCLUDED_CATALOGS.map((c) => `'${c}'`).join(", ");
        conditions.push(`${def.filterColumn} NOT IN (${exList})`);
      }
    }

    if (def.schemaColumn) {
      const exSchemas = EXCLUDED_SCHEMAS.map((s) => `'${s}'`).join(", ");
      conditions.push(`${def.schemaColumn} NOT IN (${exSchemas})`);
    }

    if (def.tableNameColumn) {
      conditions.push(`${def.tableNameColumn} NOT LIKE '!_%' ESCAPE '!'`);
    }

    if (def.name === "mdg_lineage") {
      conditions.push("source_table_full_name IS NOT NULL");
      conditions.push("target_table_full_name IS NOT NULL");
      if (catalogScope && catalogScope.length > 0) {
        const safeCats = catalogScope.map((c) => validateIdentifier(c, "catalogScope"));
        const orConditions = safeCats
          .map(
            (c) => `source_table_full_name LIKE '${c}.%' OR target_table_full_name LIKE '${c}.%'`,
          )
          .join(" OR ");
        conditions.push(`(${orConditions})`);
      }
    }

    const whereClause = conditions.length > 0 ? `\nWHERE ${conditions.join("\n  AND ")}` : "";

    // Check if this view gets an ai_comment column via CTE
    const cte =
      aiDescriptions && Object.keys(aiDescriptions).length > 0
        ? buildDescriptionsCTE(def.name, aiDescriptions)
        : null;

    let sql = `CREATE OR REPLACE VIEW ${fqnPrefix}.\`${viewName}\``;
    sql += `\nCOMMENT '${def.comment}'`;

    if (cte) {
      const cols = def.columns.map((c) => `src.${c}`).join(", ");
      sql += `\nAS WITH ${cte}`;
      sql += `\nSELECT ${cols}, COALESCE(src.comment, d.ai_description) AS ai_comment`;
      sql += `\nFROM ${def.source} src`;
      sql += `\nLEFT JOIN ai_descs d ON src.table_catalog = d.table_catalog AND src.table_schema = d.table_schema AND src.table_name = d.table_name`;
      // Prefix conditions with src. alias
      const aliasedConditions = conditions.map((c) => `src.${c}`);
      if (aliasedConditions.length > 0) {
        sql += `\nWHERE ${aliasedConditions.join("\n  AND ")}`;
      }
    } else {
      const cols = def.columns.join(", ");
      sql += `\nAS SELECT ${cols}`;
      sql += `\nFROM ${def.source}`;
      sql += whereClause;
    }

    return sql;
  });
}

/**
 * Generate DROP VIEW IF EXISTS DDL for cleanup.
 */
export function generateDropViewDDL(viewFqns: string[]): string[] {
  return viewFqns.map((fqn) => {
    const safe = validateFqn(fqn, "viewFqn");
    const parts = safe.split(".");
    const escaped = parts.map((p) => `\`${p}\``).join(".");
    return `DROP VIEW IF EXISTS ${escaped}`;
  });
}

/**
 * Return the list of view FQNs that would be created for a given target.
 */
export function getViewFqns(
  target: ViewTarget,
  lineageAccessible?: boolean,
  resourcePrefix?: string,
): string[] {
  const safeCatalog = validateIdentifier(target.catalog, "viewTarget.catalog");
  const safeSchema = validateIdentifier(target.schema, "viewTarget.schema");
  const defs = lineageAccessible ? [...VIEW_DEFS, LINEAGE_VIEW_DEF] : VIEW_DEFS;
  return defs.map((def) => {
    const viewName =
      resourcePrefix && !def.name.startsWith(resourcePrefix)
        ? `${resourcePrefix}${def.name}`
        : def.name;
    return `\`${safeCatalog}\`.\`${safeSchema}\`.\`${viewName}\``;
  });
}

/** Return the view definitions for preview/documentation. */
export function getViewDefinitions(): ViewDef[] {
  return VIEW_DEFS;
}

/** Return just the view names (without FQN prefix). */
export function getViewNames(lineageAccessible?: boolean, resourcePrefix?: string): string[] {
  const defs = lineageAccessible ? [...VIEW_DEFS, LINEAGE_VIEW_DEF] : VIEW_DEFS;
  return defs.map((d) => {
    if (resourcePrefix && !d.name.startsWith(resourcePrefix)) {
      return `${resourcePrefix}${d.name}`;
    }
    return d.name;
  });
}
