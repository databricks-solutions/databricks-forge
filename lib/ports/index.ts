/**
 * Engine Port Interfaces.
 *
 * Pure TypeScript types with zero runtime dependencies. Any engine that
 * depends only on these ports can be extracted to a standalone package.
 *
 * @module ports
 */

export type {
  ChatMessage,
  LLMRequestOptions,
  TokenUsage,
  LLMResponse,
  StreamCallback,
  LLMClient,
} from "./llm-client";

export type { SqlColumn, SqlResult, SqlExecuteOptions, SqlExecutor } from "./sql-executor";

export type { Logger } from "./logger";

export type { SkillSection, ResolvedSkills, SkillResolver } from "./skill-resolver";
export { EMPTY_RESOLVED } from "./skill-resolver";

export type { EnginePhase, EngineProgressData, EngineProgressTracker } from "./engine-progress";
