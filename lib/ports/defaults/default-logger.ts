/**
 * Default logger implementation -- delegates to `@/lib/logger`.
 */

import { logger as appLogger, createScopedLogger } from "@/lib/logger";
import type { Logger } from "../logger";

export const defaultLogger: Logger = appLogger;
export { createScopedLogger };
