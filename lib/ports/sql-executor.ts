/**
 * Abstract SQL executor interface.
 *
 * Decouples engines from the Databricks SQL Statement Execution API
 * so they can be ported to any SQL backend (DuckDB, Postgres, test stubs).
 *
 * @module ports/sql-executor
 */

export interface SqlColumn {
  name: string;
  typeName: string;
  position: number;
}

export interface SqlResult {
  columns: SqlColumn[];
  rows: string[][];
  totalRowCount: number;
}

export interface SqlExecuteOptions {
  waitTimeout?: string;
  submitTimeoutMs?: number;
}

/**
 * Abstract SQL executor. Engines depend on this interface rather than
 * importing `executeSQL` or `executeSQLMapped` directly.
 */
export interface SqlExecutor {
  execute(
    sql: string,
    catalog?: string,
    schema?: string,
    options?: SqlExecuteOptions,
  ): Promise<SqlResult>;

  executeMapped<T>(
    sql: string,
    mapper: (row: string[], columns: SqlColumn[]) => T,
    catalog?: string,
    schema?: string,
  ): Promise<T[]>;

  executeScalar<T = string>(sql: string, catalog?: string, schema?: string): Promise<T | null>;
}
