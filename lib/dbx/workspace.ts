/**
 * Databricks Workspace REST API helpers.
 *
 * Used for creating/importing notebooks into the Databricks workspace.
 * Uses getAppHeaders() (service principal) because the Workspace REST API
 * requires a scope not available on user OBO tokens. The SP token is
 * obtained with `all-apis` scope which covers workspace operations.
 */

import { getConfig, getAppHeaders } from "./client";
import { fetchWithTimeout, TIMEOUTS } from "./fetch-with-timeout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotebookLanguage = "PYTHON" | "SQL" | "SCALA" | "R";

interface ImportNotebookOptions {
  /** Workspace path (e.g. /Users/user@example.com/forge/notebooks/UC001) */
  path: string;
  /** Notebook language */
  language: NotebookLanguage;
  /** Notebook content (source code) */
  content: string;
  /** Overwrite if exists */
  overwrite?: boolean;
  /** Format -- defaults to SOURCE */
  format?: "SOURCE" | "HTML" | "JUPYTER" | "DBC";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Import (create or update) a notebook in the Databricks workspace.
 */
export async function importNotebook(options: ImportNotebookOptions): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/workspace/import`;

  const base64Content = Buffer.from(options.content, "utf-8").toString("base64");

  const body = {
    path: options.path,
    language: options.language,
    content: base64Content,
    overwrite: options.overwrite ?? true,
    format: options.format ?? "SOURCE",
  };

  const headers = await getAppHeaders();
  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workspace import failed (${response.status}): ${text}`);
  }
}

/**
 * Create a directory (folder) in the workspace, creating parents as needed.
 */
export async function mkdirs(path: string): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/workspace/mkdirs`;

  const headers = await getAppHeaders();
  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify({ path }) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workspace mkdirs failed (${response.status}): ${text}`);
  }
}

/**
 * Delete a workspace object (notebook or folder).
 */
export async function deleteWorkspaceObject(path: string, recursive = false): Promise<void> {
  const config = getConfig();
  const url = `${config.host}/api/2.0/workspace/delete`;

  const headers = await getAppHeaders();
  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify({ path, recursive }) },
    TIMEOUTS.WORKSPACE,
  );

  if (!response.ok) {
    const text = await response.text();
    // 404 is fine -- the object may not exist
    if (response.status !== 404) {
      throw new Error(`Workspace delete failed (${response.status}): ${text}`);
    }
  }
}
