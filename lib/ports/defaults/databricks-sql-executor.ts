/**
 * Default Databricks SQL executor implementation.
 *
 * Wraps `executeSQL`, `executeSQLMapped`, and `executeSQLScalar`
 * from `@/lib/dbx/sql`.
 */

import { executeSQL, executeSQLMapped, executeSQLScalar } from "@/lib/dbx/sql";
import type { SqlExecutor, SqlColumn, SqlResult, SqlExecuteOptions } from "../sql-executor";

export const databricksSqlExecutor: SqlExecutor = {
  async execute(
    sql: string,
    catalog?: string,
    schema?: string,
    options?: SqlExecuteOptions,
  ): Promise<SqlResult> {
    return executeSQL(sql, catalog, schema, options);
  },

  async executeMapped<T>(
    sql: string,
    mapper: (row: string[], columns: SqlColumn[]) => T,
    catalog?: string,
    schema?: string,
  ): Promise<T[]> {
    return executeSQLMapped(sql, mapper, catalog, schema);
  },

  async executeScalar<T = string>(
    sql: string,
    catalog?: string,
    schema?: string,
  ): Promise<T | null> {
    return executeSQLScalar<T>(sql, catalog, schema);
  },
};
