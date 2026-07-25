/**
 * Abstract logger interfaces.
 *
 * {@link Logger} matches the flat method signatures of `@/lib/logger` so
 * existing code can swap to DI with zero refactoring of log call sites.
 *
 * {@link ScopedLogger} extends Logger with context nesting (`child`) and
 * automatic lifecycle timing (`timed`). Any code typed `Logger` accepts a
 * `ScopedLogger` without changes.
 *
 * @module ports/logger
 */

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ScopedLogger extends Logger {
  readonly context: Readonly<Record<string, unknown>>;
  child(extra: Record<string, unknown>): ScopedLogger;
  timed<T>(message: string, work: () => Promise<T>, meta?: Record<string, unknown>): Promise<T>;
}
