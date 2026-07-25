/**
 * Async auth context for deferred Databricks work.
 *
 * Request headers are unavailable after an API handler enqueues background
 * work. This context retains the initiating user's OBO token across the full
 * async call tree without threading it through every Databricks helper.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface DatabricksAuthContext {
  oboToken: string | null;
}

const storage = new AsyncLocalStorage<DatabricksAuthContext>();

export function runWithDatabricksAuthContext<T>(
  context: DatabricksAuthContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getDatabricksAuthContext(): DatabricksAuthContext | null {
  return storage.getStore() ?? null;
}
