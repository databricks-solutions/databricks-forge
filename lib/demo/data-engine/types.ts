/**
 * Data Engine types.
 *
 * Defines inputs, deps, result, and per-table phase tracking types.
 */

import type { LLMClient } from "@/lib/ports/llm-client";
import type { SqlExecutor } from "@/lib/ports/sql-executor";
import type { Logger } from "@/lib/ports/logger";
import type {
  TableDesign,
  TablePhase,
  TableGenerationStatus,
  DataNarrative,
  ValidationSummary,
} from "../types";
import type { ResearchEngineResult } from "../research-engine/types";
import type { DemoDateWindow } from "./date-window";

// ---------------------------------------------------------------------------
// Engine Input & Deps
// ---------------------------------------------------------------------------

export interface DataEngineInput {
  sessionId: string;
  research: ResearchEngineResult;
  catalog: string;
  schema: string;
  targetRowCount: { min: number; max: number };
  /**
   * Target number of tables the schema designer should produce. When omitted,
   * standard bands (8-12) are used. Genie Mode raises this to 12-18.
   */
  targetTableCount?: { min: number; max: number };
  /**
   * Fiscal-year start month (1-12). Defaults to January (calendar FY).
   * Controls the DemoDateWindow anchor -- e.g. set to 4 for April FY start.
   */
  fiscalYearStartMonth?: number;
  /**
   * When true, bias every pass toward a Genie-Space-optimal schema and, after
   * validation, run the ad-hoc Genie Engine + create a Genie Space bound to
   * the generated `catalog.schema`.
   */
  genieMode?: boolean;
  /**
   * OBO token captured from the originating request (e.g. the API route).
   * Required when `genieMode=true` so the Genie create call runs as the user,
   * not the app service principal. See .cursor/rules/genie-obo-auth.mdc.
   */
  oboToken?: string;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
  onTablePhase?: (tableName: string, phase: TablePhase) => void;
  onTablesReady?: (tables: TableDesign[]) => void;
  deps?: DataEngineDeps;
  /**
   * Email of the user who initiated this run. Used for ownership tagging on
   * any downstream resources (Genie space, deployed dashboards) created in the
   * fire-and-forget background closure.
   */
  ownerEmail?: string | null;
}

export interface DataEngineDeps {
  llm?: LLMClient;
  sql?: SqlExecutor;
  logger?: Logger;
  reviewAndFixSql?: (
    sql: string,
    error: string,
    context?: string,
  ) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export type DataPhase =
  | "narrative-design"
  | "schema-design"
  | "seed-generation"
  | "fact-generation"
  | "validation"
  | "genie-deploy"
  | "complete";

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface TableResult {
  name: string;
  fqn: string;
  rowCount: number;
  status: "completed" | "failed";
  error?: string;
  retryCount: number;
}

export interface DataEngineResult {
  sessionId: string;
  catalog: string;
  schema: string;
  tables: TableResult[];
  narratives: DataNarrative[];
  designs: TableDesign[];
  totalRows: number;
  totalTables: number;
  validationSummary: ValidationSummary;
  durationMs: number;
  /** Date window the data was anchored to (rolling FY + YTD). */
  dateWindow: DemoDateWindow;
  /**
   * When Genie Mode auto-deployed a Genie Space, the Databricks space_id.
   * Only populated when `DataEngineInput.genieMode === true` and the deploy
   * pass succeeded.
   */
  genieSpaceId?: string;
  /**
   * Deep link to the deployed Genie Space (when Genie Mode is on). Built as
   * `${DATABRICKS_HOST}/genie/rooms/${space_id}`.
   */
  genieSpaceUrl?: string;
  /**
   * Recorded reason when Genie Mode was requested but the deploy pass did not
   * run (e.g. validation failed) or failed partway. Omitted on success.
   */
  genieDeployError?: string;
}

// ---------------------------------------------------------------------------
// Status (for polling)
// ---------------------------------------------------------------------------

export interface DataJobStatus {
  sessionId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  message: string;
  percent: number;
  totalTables: number;
  completedTables: number;
  tableStatuses: TableGenerationStatus[];
  error?: string;
  startedAt: number;
}
