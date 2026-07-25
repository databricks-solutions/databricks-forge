/**
 * Benchmark feature gate.
 *
 * The benchmark catalog, embedding, and RAG retrieval are gated on the
 * `FORGE_BENCHMARKS_ENABLED` env var.  When absent or not `"true"`,
 * all benchmark-specific server code paths become no-ops and the
 * pipeline falls back to the hardcoded DEFAULT_PACK.
 */
export function isBenchmarksEnabled(): boolean {
  return process.env.FORGE_BENCHMARKS_ENABLED === "true";
}
