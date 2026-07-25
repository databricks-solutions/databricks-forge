/**
 * Embedding feature gate.
 *
 * All embedding functionality (generation, search, knowledge base, RAG)
 * is gated on the `serving-endpoint-embedding` Databricks App resource
 * being bound.  When the resource is absent the env var is empty and
 * every embedding code path silently becomes a no-op.
 *
 * Existing customers who redeploy without the resource keep the same
 * pipeline behaviour they had before — no errors, no log noise.
 */

/**
 * Returns `true` when the embedding endpoint resource is configured.
 *
 * Checks `DATABRICKS_EMBEDDING_ENDPOINT`, which is populated from the
 * `serving-endpoint-embedding` app resource binding.  If the resource
 * is not bound the env var is either absent or empty string — both
 * evaluate to `false`.
 */
export function isEmbeddingEnabled(): boolean {
  return !!process.env.DATABRICKS_EMBEDDING_ENDPOINT;
}
