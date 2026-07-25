/**
 * SQL Statement Execution API helpers.
 *
 * Executes SQL on a Databricks SQL Warehouse via the Statement Execution API.
 * Handles polling for async results and maps rows to typed objects.
 *
 * Docs: https://docs.databricks.com/api/workspace/statementexecution
 */

import { getConfig, getHeaders } from "./client";
import { fetchWithTimeout, TIMEOUTS } from "./fetch-with-timeout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatementResponse {
  statement_id: string;
  status: {
    state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "CLOSED";
    error?: {
      error_code: string;
      message: string;
    };
  };
  manifest?: {
    schema: {
      columns: Array<{
        name: string;
        type_name: string;
        position: number;
      }>;
    };
    total_chunk_count: number;
    total_row_count: number;
  };
  result?: {
    chunk_index: number;
    row_offset: number;
    row_count: number;
    data_array?: string[][];
    next_chunk_index?: number;
    next_chunk_internal_link?: string;
  };
}

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

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 600; // 10 minutes max

export interface ExecuteSQLOptions {
  /**
   * Server-side wait_timeout for the Statement Execution API.
   * Controls how long the server holds the connection trying to return
   * results inline before falling back to async polling.
   *
   * Set to "0s" for long-running queries so the server
   * returns immediately with a statement_id and we poll for results.
   *
   * Default: "50s" (good for regular SQL that usually completes quickly).
   */
  waitTimeout?: string;
  /**
   * Client-side fetch timeout (ms) for the initial statement submission.
   * Must be greater than `waitTimeout` to avoid aborting before the server responds.
   *
   * Default: TIMEOUTS.SQL_SUBMIT (60s).
   */
  submitTimeoutMs?: number;
}

/**
 * Execute a SQL statement and return all result rows.
 *
 * @param sql       The SQL statement to execute
 * @param catalog   Optional catalog context
 * @param schema    Optional schema context
 * @param options   Optional execution options (timeouts)
 * @returns         Typed result with column metadata and row data
 */
export async function executeSQL(
  sql: string,
  catalog?: string,
  schema?: string,
  options?: ExecuteSQLOptions,
): Promise<SqlResult> {
  return executeSQLUsingHeaders(sql, getHeaders, catalog, schema, options);
}

/** Execute SQL with the captured user's OBO identity for every request and poll. */
export async function executeSQLWithToken(
  sql: string,
  oboToken: string,
  catalog?: string,
  schema?: string,
  options?: ExecuteSQLOptions,
): Promise<SqlResult> {
  if (!oboToken) throw new Error("An OBO token is required for user-scoped SQL execution");
  const headers = async () => ({
    Authorization: `Bearer ${oboToken}`,
    "Content-Type": "application/json",
  });
  return executeSQLUsingHeaders(sql, headers, catalog, schema, options);
}

async function executeSQLUsingHeaders(
  sql: string,
  resolveHeaders: () => Promise<Record<string, string>>,
  catalog?: string,
  schema?: string,
  options?: ExecuteSQLOptions,
): Promise<SqlResult> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/sql/statements/`;

  const waitTimeout = options?.waitTimeout ?? "50s";
  const submitTimeoutMs = options?.submitTimeoutMs ?? TIMEOUTS.SQL_SUBMIT;

  const body: Record<string, unknown> = {
    warehouse_id: config.warehouseId,
    statement: sql,
    wait_timeout: waitTimeout,
    on_wait_timeout: "CONTINUE",
    disposition: "INLINE",
    format: "JSON_ARRAY",
  };
  if (catalog) body.catalog = catalog;
  if (schema) body.schema = schema;

  const headers = await resolveHeaders();
  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    submitTimeoutMs,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQL Statement Execution API error (${response.status}): ${text}`);
  }

  let result: StatementResponse = await response.json();

  // Poll if the statement is still running
  let attempts = 0;
  while (
    (result.status.state === "PENDING" || result.status.state === "RUNNING") &&
    attempts < MAX_POLL_ATTEMPTS
  ) {
    await sleep(POLL_INTERVAL_MS);
    result = await pollStatement(result.statement_id, resolveHeaders);
    attempts++;
  }

  if (result.status.state === "FAILED") {
    throw new Error(`SQL execution failed: ${result.status.error?.message ?? "Unknown error"}`);
  }

  if (result.status.state === "CANCELED") {
    throw new Error("SQL execution was canceled");
  }

  if (result.status.state !== "SUCCEEDED") {
    throw new Error(`Unexpected statement state: ${result.status.state}`);
  }

  const columns: SqlColumn[] =
    result.manifest?.schema?.columns?.map((c) => ({
      name: c.name,
      typeName: c.type_name,
      position: c.position,
    })) ?? [];

  // Collect all result chunks
  let allRows: string[][] = result.result?.data_array ?? [];

  // Fetch additional chunks if present
  if (result.result?.next_chunk_internal_link) {
    let nextLink: string | undefined = result.result.next_chunk_internal_link;
    while (nextLink) {
      const chunkHeaders = await resolveHeaders();
      const chunkResp: Response = await fetchWithTimeout(
        `${config.host}${nextLink}`,
        { headers: chunkHeaders },
        TIMEOUTS.SQL_CHUNK,
      );
      if (!chunkResp.ok) break;
      const chunk: { data_array?: string[][]; next_chunk_internal_link?: string } =
        await chunkResp.json();
      if (chunk.data_array) {
        allRows = allRows.concat(chunk.data_array);
      }
      nextLink = chunk.next_chunk_internal_link;
    }
  }

  return {
    columns,
    rows: allRows,
    totalRowCount: result.manifest?.total_row_count ?? allRows.length,
  };
}

/**
 * Execute SQL and map each row to a typed object using a mapper function.
 */
export async function executeSQLMapped<T>(
  sql: string,
  mapper: (row: string[], columns: SqlColumn[]) => T,
  catalog?: string,
  schema?: string,
): Promise<T[]> {
  const result = await executeSQL(sql, catalog, schema);
  return result.rows.map((row) => mapper(row, result.columns));
}

/**
 * Execute SQL that returns a single scalar value.
 */
export async function executeSQLScalar<T = string>(
  sql: string,
  catalog?: string,
  schema?: string,
): Promise<T | null> {
  const result = await executeSQL(sql, catalog, schema);
  if (result.rows.length === 0 || result.rows[0].length === 0) return null;
  return result.rows[0][0] as T;
}

/**
 * Cancel an in-flight SQL statement.
 *
 * Headers are resolved at cancellation time so deferred work retains the same
 * user-scoped authentication as submission, polling, and result retrieval.
 */
export async function cancelStatement(statementId: string): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/sql/statements/${statementId}/cancel`;
  const headers = await getHeaders();
  const response = await fetchWithTimeout(url, { method: "POST", headers }, TIMEOUTS.SQL_POLL);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQL cancellation failed (${response.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function pollStatement(
  statementId: string,
  resolveHeaders: () => Promise<Record<string, string>> = getHeaders,
): Promise<StatementResponse> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/sql/statements/${statementId}`;
  const headers = await resolveHeaders();
  const response = await fetchWithTimeout(url, { method: "GET", headers }, TIMEOUTS.SQL_POLL);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Poll error (${response.status}): ${text}`);
  }
  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
