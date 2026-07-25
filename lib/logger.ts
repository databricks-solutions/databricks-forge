/**
 * Structured logging utility with scoped context support.
 *
 * Outputs JSON in production for log aggregation, and human-readable
 * formatted output in development.
 *
 * Every log entry includes the app version (`v`) for deployment tracing.
 *
 * ## Flat logger (backward compatible)
 *
 *   import { logger } from "@/lib/logger";
 *   logger.info("Step complete", { runId, step: "scoring", count: 42 });
 *
 * ## Scoped logger (preferred for new code)
 *
 *   import { createScopedLogger } from "@/lib/logger";
 *   const log = createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine", runId });
 *   const stepLog = log.child({ task: "SqlGeneration", module: "pipeline/steps/sql-generation" });
 *   stepLog.warn("SQL validation failed", { fn: "generateSqlForUseCase", errorCategory: "sql_hallucination" });
 *   const result = await stepLog.timed("Generate SQL", () => doWork(), { fn: "generateSqlForUseCase" });
 */

import packageJson from "@/package.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  v: string;
  [key: string]: unknown;
}

/**
 * Structured context carried by a {@link ScopedLogger}.
 *
 * Well-known fields are typed explicitly so auto-complete works; the index
 * signature allows ad-hoc extras without a cast.
 */
export interface LogContext {
  /** Top-level feature area (e.g. DiscoveryRun, GenieEngine, AskForge). */
  origin?: string;
  /** Step / pass / phase within the origin (e.g. SqlGeneration, TablePass). */
  task?: string;
  /** Source file path relative to lib/ (e.g. pipeline/steps/sql-generation). */
  module?: string;
  /** Function name within the module. */
  fn?: string;
  /** Pipeline run correlation ID. */
  runId?: string;
  /** Engine job correlation ID. */
  jobId?: string;
  /** Estate scan correlation ID. */
  scanId?: string;
  /** Conversation correlation ID. */
  conversationId?: string;
  /** API route path. */
  route?: string;
  /** HTTP method. */
  method?: string;
  /** Lifecycle phase of the operation. */
  phase?: "start" | "progress" | "end" | "error";
  /** Standardised failure category for pattern matching. */
  errorCategory?: string;
  /** Elapsed time in ms (auto-set by {@link ScopedLogger.timed}). */
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Logger with immutable context that is merged into every log entry.
 *
 * Create via {@link createScopedLogger}. Nest via {@link ScopedLogger.child}.
 */
export interface ScopedLogger {
  readonly context: Readonly<LogContext>;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /** Create a child logger that inherits this context plus extras. */
  child(extra: LogContext): ScopedLogger;
  /** Run `work`, auto-emitting start/end (or error) entries with durationMs. */
  timed<T>(message: string, work: () => Promise<T>, meta?: Record<string, unknown>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_VERSION = packageJson.version;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? (IS_PRODUCTION ? "info" : "debug");

// Well-known context keys extracted into the dev breadcrumb trail and excluded
// from the trailing JSON blob to keep dev output compact.
const BREADCRUMB_KEYS = new Set([
  "origin",
  "task",
  "module",
  "fn",
  "phase",
  "route",
  "method",
  "runId",
  "jobId",
  "scanId",
  "conversationId",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatDev(entry: LogEntry): string {
  const { level, message, timestamp, v, ...rest } = entry;
  const prefix = `[${level.toUpperCase().padEnd(5)}]`;
  const time = timestamp.split("T")[1]?.replace("Z", "") ?? timestamp;

  const origin = rest.origin as string | undefined;
  const task = rest.task as string | undefined;
  const fn = rest.fn as string | undefined;
  const phase = rest.phase as string | undefined;

  const crumbs = [origin, task, fn].filter(Boolean).join(" > ");
  const crumbStr = crumbs ? ` ${crumbs} |` : "";

  const corrId = (rest.runId ?? rest.jobId ?? rest.scanId ?? rest.conversationId) as
    | string
    | undefined;
  const corrLabel = rest.runId
    ? "run"
    : rest.jobId
      ? "job"
      : rest.scanId
        ? "scan"
        : rest.conversationId
          ? "conv"
          : "";
  const corrTag = corrId ? ` [${corrLabel}:${String(corrId).slice(0, 8)}]` : "";

  const phaseTag = phase ? ` (${phase})` : "";

  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(rest)) {
    if (!BREADCRUMB_KEYS.has(k)) extra[k] = val;
  }
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";

  return `${time} ${prefix} [v${v}]${corrTag}${crumbStr} ${message}${phaseTag}${extraStr}`;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    v: APP_VERSION,
    ...meta,
  };

  const output = IS_PRODUCTION ? JSON.stringify(entry) : formatDev(entry);

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    default:
      console.log(output);
      break;
  }
}

// ---------------------------------------------------------------------------
// Flat singleton logger (backward compatible)
// ---------------------------------------------------------------------------

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

// ---------------------------------------------------------------------------
// Scoped logger factory
// ---------------------------------------------------------------------------

/**
 * Create a logger that carries fixed context merged into every log entry.
 *
 * ```ts
 * const log = createScopedLogger({ origin: "DiscoveryRun", module: "pipeline/engine", runId });
 * log.info("Pipeline started", { phase: "start" });
 *
 * const stepLog = log.child({ task: "SqlGeneration", module: "pipeline/steps/sql-generation" });
 * stepLog.warn("Validation failed", { fn: "generateSql", errorCategory: "sql_hallucination" });
 *
 * await stepLog.timed("Generate SQL", () => generateSql(uc), { fn: "generateSql" });
 * ```
 */
export function createScopedLogger(context: LogContext): ScopedLogger {
  const frozen = Object.freeze({ ...context });

  const self: ScopedLogger = {
    context: frozen,
    debug: (msg, meta) => emit("debug", msg, { ...frozen, ...meta }),
    info: (msg, meta) => emit("info", msg, { ...frozen, ...meta }),
    warn: (msg, meta) => emit("warn", msg, { ...frozen, ...meta }),
    error: (msg, meta) => emit("error", msg, { ...frozen, ...meta }),
    child: (extra) => createScopedLogger({ ...frozen, ...extra }),

    async timed<T>(
      message: string,
      work: () => Promise<T>,
      meta?: Record<string, unknown>,
    ): Promise<T> {
      const t0 = performance.now();
      self.info(`${message} started`, { ...meta, phase: "start" as const });
      try {
        const result = await work();
        self.info(`${message} completed`, {
          ...meta,
          phase: "end" as const,
          durationMs: Math.round(performance.now() - t0),
        });
        return result;
      } catch (err) {
        self.error(`${message} failed`, {
          ...meta,
          phase: "error" as const,
          durationMs: Math.round(performance.now() - t0),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  };
  return self;
}

/**
 * Convenience factory for API route handlers.
 *
 * ```ts
 * const log = apiLogger("/api/runs/[runId]/execute", "POST", { runId });
 * ```
 */
export function apiLogger(route: string, method: string, extra?: LogContext): ScopedLogger {
  return createScopedLogger({ origin: "API", route, method, ...extra });
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const _g = globalThis as unknown as { __forgeStartupLogged?: boolean };
if (IS_PRODUCTION && !_g.__forgeStartupLogged) {
  _g.__forgeStartupLogged = true;
  emit("info", `Databricks Forge v${APP_VERSION} starting`);
}
