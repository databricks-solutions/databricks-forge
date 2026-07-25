# Standard Engine Contract

> Reference specification for all Forge engines. Each engine should converge
> toward this pattern over time.

## Required Capabilities

| Capability | Description | Status |
|---|---|---|
| **DI via deps** | Accept optional `deps` object with `LLMClient`, `Logger` | Comment, Dashboard, Genie, Health Check |
| **AbortSignal** | Accept `signal` for cancellation | Comment, Genie |
| **Progress callback** | Report phase + percent + detail | Comment, Dashboard, Genie |
| **Structured counters** | Report granular progress (items found/processed) | Comment |
| **cachedChatCompletion** | Use cache+retry LLM wrapper | Comment, Genie |
| **Token-aware batching** | Size LLM batches by estimated tokens | Comment |
| **mapWithConcurrency** | Bounded parallel execution | Dashboard, Genie |
| **Facade separation** | Engine returns result; separate module handles persistence | Comment |
| **In-memory progress** | Singleton Map with TTL for polling | Comment, Genie, Dashboard |
| **Polling API** | GET endpoint for clients to poll progress | Comment, Genie, Dashboard |

## Future Convergence Tasks

- Dashboard Engine: Add AbortSignal support, structured counters, token batching, cachedChatCompletion
- Genie Engine: Add structured counters beyond domain-level, token batching for large schemas
- Health Check: Add progress callback for multi-check evaluation
- All engines: Migrate in-memory progress to unified EngineProgressTracker port
