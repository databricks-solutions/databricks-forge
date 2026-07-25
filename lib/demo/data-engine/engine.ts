/**
 * Data Engine -- generates demo data in Unity Catalog.
 *
 * Orchestrates 5 passes: narrative design, schema design, seed generation,
 * fact generation, and validation. Tables are written directly to managed
 * Delta tables via the SQL Statement Execution API.
 */

import { createScopedLogger } from "@/lib/logger";
import { databricksLLMClient } from "@/lib/ports/defaults/databricks-llm-client";
import { databricksSqlExecutor } from "@/lib/ports/defaults/databricks-sql-executor";
import { reviewAndFixSql as sqlReviewerReviewAndFix } from "@/lib/ai/sql-reviewer";
import { mapWithConcurrency } from "@/lib/toolkit/concurrency";
import type { DataEngineInput, DataEngineResult, TableResult } from "./types";
import type { TableDesign, DataNarrative, TablePhase } from "../types";

/** Adapter: sql-reviewer returns ReviewResult; seed/fact passes expect (sql, error, context) => Promise<string>. */
function adaptReviewAndFixSql(sql: string, error: string, context?: string): Promise<string> {
  return sqlReviewerReviewAndFix(sql, {
    schemaContext: context,
    runtimeError: error,
    requestFix: true,
  }).then((r) => r.fixedSql ?? sql);
}

import { runNarrativeDesign } from "./passes/narrative-design";
import { runSchemaDesign } from "./passes/schema-design";
import { runSeedGeneration } from "./passes/seed-generation";
import {
  runFactGeneration,
  regenerateFactForFreshness,
} from "./passes/fact-generation";
import { runValidation } from "./passes/validation";
import { runGenieDeploy } from "./passes/genie-deploy";
import { computeDemoDateWindow } from "./date-window";

export class DataEngineCancelledError extends Error {
  constructor() {
    super("Data generation was cancelled");
    this.name = "DataEngineCancelledError";
  }
}

const FACT_CONCURRENCY = 4;
const DIM_CONCURRENCY = 4;

export async function runDataEngine(input: DataEngineInput): Promise<DataEngineResult> {
  const startTime = Date.now();
  const llm = input.deps?.llm ?? databricksLLMClient;
  const sql = input.deps?.sql ?? databricksSqlExecutor;
  const log =
    input.deps?.logger ?? createScopedLogger({ origin: "DataEngine", module: "demo/data-engine" });
  const reviewFn = input.deps?.reviewAndFixSql ?? adaptReviewAndFixSql;
  const signal = input.signal;

  const progress = (msg: string, pct: number) => input.onProgress?.(msg, pct);

  // =======================================================================
  // Compute the rolling demo date window ONCE. Every prompt + validation
  // step downstream anchors to this window so the demo can never drift
  // into a stale year.
  // =======================================================================
  const dateWindow = computeDemoDateWindow(new Date(), input.fiscalYearStartMonth);

  log.info("Starting data engine", {
    sessionId: input.sessionId,
    catalog: input.catalog,
    schema: input.schema,
    targetRows: input.targetRowCount,
    dateWindow: {
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      fyLabel: dateWindow.fyLabel,
      dateRangeDays: dateWindow.dateRangeDays,
    },
  });

  // =======================================================================
  // Pass 0: Narrative Design
  // =======================================================================
  log.info("Pass 0: Narrative design", { sessionId: input.sessionId });
  progress("Designing data narratives...", 5);
  checkCancelled(signal);

  const narrativeResult = await runNarrativeDesign(
    input.research,
    input.targetRowCount,
    dateWindow,
    { llm, logger: log, signal, genieMode: input.genieMode },
  );

  const narratives: DataNarrative[] = narrativeResult.narratives.map((n) => ({
    title: n.title,
    description: n.description,
    affectedTables: n.affectedTables,
    pattern: n.pattern,
  }));

  // =======================================================================
  // Pass 1: Schema Design
  // =======================================================================
  log.info("Pass 1: Schema design", {
    narrativeCount: narratives.length,
    targetRows: input.targetRowCount,
  });
  progress("Designing table schema...", 15);
  checkCancelled(signal);

  const tables = await runSchemaDesign(input.research, narratives, input.targetRowCount, {
    llm,
    logger: log,
    signal,
    genieMode: input.genieMode,
  });

  input.onTablesReady?.(tables);

  // Create schema if it doesn't exist
  try {
    await sql.execute(`CREATE SCHEMA IF NOT EXISTS \`${input.catalog}\`.\`${input.schema}\``);
  } catch (err) {
    log.error("Failed to create schema", { error: String(err) });
    throw err;
  }

  log.info("Schema created", { catalog: input.catalog, schema: input.schema });

  // =======================================================================
  // Pass 2: Seed Generation (dimension tables)
  // =======================================================================
  const dimensionTables = tables.filter((t) => t.tableType === "dimension");
  const factTables = tables.filter((t) => t.tableType === "fact");
  const tableResults: TableResult[] = [];
  const tableFqns: string[] = [];

  log.info("Pass 2: Seed generation", {
    dimensionTables: dimensionTables.length,
    concurrency: DIM_CONCURRENCY,
  });

  const dimTasks = dimensionTables.map((table: TableDesign) => async (): Promise<TableResult> => {
    checkCancelled(signal);
    const t0 = Date.now();

    log.info("Generating dimension table", {
      table: table.name,
      columns: table.columns.length,
      rowTarget: table.rowTarget,
    });

    const onPhase = (phase: TablePhase) => input.onTablePhase?.(table.name, phase);
    const result = await runSeedGeneration(
      table,
      input.catalog,
      input.schema,
      {
        customerName: input.research.customerName,
        industryId: input.research.industryId,
        nomenclature: input.research.nomenclature,
        scope: input.research.scope,
      },
      dateWindow,
      { llm, sql, logger: log, signal, onPhase, reviewAndFixSql: reviewFn, genieMode: input.genieMode },
    );

    const fqn = `\`${input.catalog}\`.\`${input.schema}\`.\`${table.name}\``;
    tableFqns.push(fqn);

    log.info(result.error ? "Dimension table failed" : "Dimension table created", {
      table: table.name,
      rowCount: result.rowCount,
      durationMs: Date.now() - t0,
      ...(result.error ? { error: result.error } : {}),
    });

    return {
      name: table.name,
      fqn,
      rowCount: result.rowCount,
      status: result.error ? "failed" : "completed",
      error: result.error,
      retryCount: 0,
    };
  });

  const dimResults = await mapWithConcurrency(dimTasks, DIM_CONCURRENCY);
  tableResults.push(...dimResults);

  // Filter dimension tables to only those that were successfully created.
  // Failed dimensions (e.g. dim_date) must not appear in fact table prompts
  // or the LLM will generate JOINs to non-existent tables.
  const succeededDimNames = new Set(
    dimResults.filter((r) => r.status === "completed").map((r) => r.name),
  );
  const successfulDimensions = dimensionTables.filter((d) => succeededDimNames.has(d.name));

  if (successfulDimensions.length < dimensionTables.length) {
    const failed = dimensionTables.filter((d) => !succeededDimNames.has(d.name)).map((d) => d.name);
    log.warn("Excluding failed dimensions from fact generation context", {
      failed,
      remaining: successfulDimensions.map((d) => d.name),
    });
  }

  // =======================================================================
  // Pass 3: Fact Generation (fact/transaction tables -- wave-based)
  // =======================================================================
  log.info("Pass 3: Fact generation", {
    factTables: factTables.length,
    concurrency: FACT_CONCURRENCY,
  });

  // Detect fact-to-fact FK dependencies and sort into waves
  const completedTableNames = new Set(
    tableResults.filter((r) => r.status === "completed").map((r) => r.name),
  );
  const factWaves = buildFactWaves(factTables, completedTableNames);

  log.info("Fact table dependency waves", {
    waves: factWaves.length,
    breakdown: factWaves.map((w, i) => ({
      wave: i,
      tables: w.map((t) => t.name),
    })),
  });

  for (let waveIdx = 0; waveIdx < factWaves.length; waveIdx++) {
    const wave = factWaves[waveIdx];
    checkCancelled(signal);

    const wavePercent = 50 + Math.round((waveIdx / factWaves.length) * 35);
    progress(`Generating fact tables (wave ${waveIdx + 1}/${factWaves.length})...`, wavePercent);

    const skippedInWave: TableResult[] = [];
    const executableInWave: TableDesign[] = [];

    for (const table of wave) {
      const fqn = `\`${input.catalog}\`.\`${input.schema}\`.\`${table.name}\``;

      // Skip if an upstream fact dependency failed
      const factDeps = getFactDependencies(table, factTables);
      const failedFactDep = factDeps.find((dep) =>
        tableResults.some((r) => r.name === dep && r.status === "failed"),
      );
      if (failedFactDep) {
        log.warn("Skipping fact table -- upstream fact dependency failed", {
          table: table.name,
          failedDependency: failedFactDep,
        });
        input.onTablePhase?.(table.name, "failed");
        skippedInWave.push({
          name: table.name,
          fqn,
          rowCount: 0,
          status: "failed",
          error: `Skipped: fact dependency '${failedFactDep}' failed`,
          retryCount: 0,
        });
        continue;
      }

      // Skip if ALL referenced dimension tables failed (no FK data available)
      const dimRefs = table.columns
        .filter((c) => c.role === "fk" && c.fkTarget)
        .map((c) => c.fkTarget!.split(".")[0])
        .filter((ref) => dimensionTables.some((d) => d.name === ref));
      if (dimRefs.length > 0 && dimRefs.every((ref) => !succeededDimNames.has(ref))) {
        log.warn("Skipping fact table -- all referenced dimensions failed", {
          table: table.name,
          failedDims: dimRefs,
        });
        input.onTablePhase?.(table.name, "failed");
        skippedInWave.push({
          name: table.name,
          fqn,
          rowCount: 0,
          status: "failed",
          error: `Skipped: all dimension dependencies failed (${dimRefs.join(", ")})`,
          retryCount: 0,
        });
        continue;
      }

      executableInWave.push(table);
    }

    tableResults.push(...skippedInWave);

    const waveTasks = executableInWave.map(
      (table: TableDesign) => async (): Promise<TableResult> => {
        checkCancelled(signal);
        const t0 = Date.now();

        log.info("Generating fact table", {
          table: table.name,
          columns: table.columns.length,
          rowTarget: table.rowTarget,
          wave: waveIdx,
        });

        const onPhase = (phase: TablePhase) => input.onTablePhase?.(table.name, phase);
        const result = await runFactGeneration(
          table,
          input.catalog,
          input.schema,
          successfulDimensions,
          narratives,
          {
            customerName: input.research.customerName,
            industryId: input.research.industryId,
            nomenclature: input.research.nomenclature,
          },
          dateWindow,
          { llm, sql, logger: log, signal, onPhase, reviewAndFixSql: reviewFn, genieMode: input.genieMode },
        );

        const fqn = `\`${input.catalog}\`.\`${input.schema}\`.\`${table.name}\``;
        tableFqns.push(fqn);

        log.info(result.error ? "Fact table failed" : "Fact table created", {
          table: table.name,
          rowCount: result.rowCount,
          durationMs: Date.now() - t0,
          wave: waveIdx,
          ...(result.error ? { error: result.error } : {}),
        });

        return {
          name: table.name,
          fqn,
          rowCount: result.rowCount,
          status: result.error ? "failed" : "completed",
          error: result.error,
          retryCount: 0,
        };
      },
    );

    const waveResults = await mapWithConcurrency(waveTasks, FACT_CONCURRENCY);
    tableResults.push(...waveResults);
    waveResults.forEach((r) => {
      if (r.status === "completed") completedTableNames.add(r.name);
    });
  }

  // =======================================================================
  // Pass 4: Validation (row counts, FK integrity, date coverage)
  // =======================================================================
  log.info("Pass 4: Validation", { totalTables: tables.length });
  progress("Validating generated data...", 90);

  let validationSummary = await runValidation(tables, input.catalog, input.schema, dateWindow, {
    sql,
    logger: log,
  });

  // =======================================================================
  // Pass 4b: Freshness auto-fix (single retry for stale fact tables)
  // =======================================================================
  const staleFactRetryNames = (validationSummary.results ?? [])
    .filter((r) => r.dateCoverage?.stale)
    .map((r) => r.tableName)
    .filter((name) => factTables.some((t) => t.name === name));

  if (staleFactRetryNames.length > 0) {
    log.warn("Stale fact tables detected -- running freshness auto-fix", {
      tables: staleFactRetryNames,
      window: `${dateWindow.startDate}..${dateWindow.endDate}`,
    });
    progress(`Refreshing ${staleFactRetryNames.length} stale fact table(s)...`, 93);

    for (const staleName of staleFactRetryNames) {
      checkCancelled(signal);
      const table = factTables.find((t) => t.name === staleName);
      const observed = validationSummary.results?.find((r) => r.tableName === staleName)
        ?.dateCoverage;
      if (!table || !observed) continue;

      const onPhase = (phase: TablePhase) => input.onTablePhase?.(table.name, phase);

      const fixResult = await regenerateFactForFreshness(
        table,
        input.catalog,
        input.schema,
        successfulDimensions,
        narratives,
        {
          customerName: input.research.customerName,
          industryId: input.research.industryId,
          nomenclature: input.research.nomenclature,
        },
        dateWindow,
        {
          columnName: observed.columnName,
          minDate: observed.minDate,
          maxDate: observed.maxDate,
        },
        { llm, sql, logger: log, signal, onPhase, genieMode: input.genieMode },
      );

      const existing = tableResults.find((r) => r.name === staleName);
      if (existing) {
        existing.status = fixResult.error ? "failed" : "completed";
        existing.rowCount = fixResult.rowCount;
        existing.error = fixResult.error;
        existing.retryCount += 1;
      }
    }

    // Re-run validation ONLY for tables that were refreshed.
    const refreshedTables = tables.filter((t) => staleFactRetryNames.includes(t.name));
    const revalidation = await runValidation(refreshedTables, input.catalog, input.schema, dateWindow, {
      sql,
      logger: log,
    });

    // Merge revalidation results back into the full summary.
    if (validationSummary.results && revalidation.results) {
      const updatedByName = new Map(revalidation.results.map((r) => [r.tableName, r]));
      const mergedResults = validationSummary.results.map(
        (r) => updatedByName.get(r.tableName) ?? r,
      );
      validationSummary = {
        ...validationSummary,
        results: mergedResults,
        // Recompute aggregate issue list + passed count off the merged view.
        issues: mergedResults.flatMap((r) => r.issues.map((i) => `${r.tableName}: ${i}`)),
        passedTables: mergedResults.filter((r) => r.issues.length === 0).length,
      };
    }
  }

  // =======================================================================
  // Pass 5: Genie Deploy (Genie Mode only, non-fatal)
  // =======================================================================
  let genieSpaceId: string | undefined;
  let genieSpaceUrl: string | undefined;
  let genieDeployError: string | undefined;

  if (input.genieMode) {
    const anyFactSucceeded = tableResults.some(
      (r) => r.status === "completed" && factTables.some((t) => t.name === r.name),
    );
    if (!anyFactSucceeded) {
      genieDeployError = "No fact tables succeeded -- skipping Genie Space deploy.";
      log.warn(genieDeployError, { sessionId: input.sessionId });
    } else {
      log.info("Pass 5: Genie deploy", { sessionId: input.sessionId });
      progress("Deploying Genie Space...", 95);
      try {
        const deployResult = await runGenieDeploy({
          sessionId: input.sessionId,
          catalog: input.catalog,
          schema: input.schema,
          tableDesigns: tables,
          tableResults,
          research: input.research,
          oboToken: input.oboToken,
          ownerEmail: input.ownerEmail ?? null,
          logger: log,
          signal,
          onProgress: (msg, pct) => {
            progress(msg, 95 + Math.floor(pct * 0.04));
          },
        });
        genieSpaceId = deployResult.spaceId;
        genieSpaceUrl = deployResult.spaceUrl;
        log.info("Genie Space deploy complete", {
          sessionId: input.sessionId,
          spaceId: genieSpaceId,
        });
      } catch (err) {
        genieDeployError = err instanceof Error ? err.message : String(err);
        log.error("Genie Space deploy failed (non-fatal)", {
          sessionId: input.sessionId,
          error: genieDeployError,
        });
      }
    }
  }

  // =======================================================================
  // Result
  // =======================================================================
  const durationMs = Date.now() - startTime;

  const result: DataEngineResult = {
    sessionId: input.sessionId,
    catalog: input.catalog,
    schema: input.schema,
    tables: tableResults,
    narratives,
    designs: tables,
    totalRows: tableResults.reduce((sum, t) => sum + t.rowCount, 0),
    totalTables: tables.length,
    validationSummary,
    durationMs,
    dateWindow,
    genieSpaceId,
    genieSpaceUrl,
    genieDeployError,
  };

  log.info("Data engine complete", {
    tables: result.totalTables,
    rows: result.totalRows,
    durationMs,
    failed: tableResults.filter((t) => t.status === "failed").length,
  });

  progress("Complete", 100);
  return result;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DataEngineCancelledError();
}

/** Extract fact-table names that a given fact table depends on via FK columns. */
function getFactDependencies(table: TableDesign, allFactTables: TableDesign[]): string[] {
  const factNames = new Set(allFactTables.map((f) => f.name));
  return table.columns
    .filter((c) => c.role === "fk" && c.fkTarget)
    .map((c) => c.fkTarget!.split(".")[0])
    .filter((refTable) => factNames.has(refTable));
}

/** Topologically sort fact tables into dependency waves. */
function buildFactWaves(
  factTables: TableDesign[],
  completedTableNames: Set<string>,
): TableDesign[][] {
  const remaining = [...factTables];
  const waves: TableDesign[][] = [];
  const placed = new Set<string>(completedTableNames);

  while (remaining.length > 0) {
    const wave: TableDesign[] = [];
    const stillBlocked: TableDesign[] = [];

    for (const table of remaining) {
      const deps = getFactDependencies(table, factTables);
      const unmet = deps.filter((d) => !placed.has(d));
      if (unmet.length === 0) {
        wave.push(table);
      } else {
        stillBlocked.push(table);
      }
    }

    if (wave.length === 0) {
      // Circular dependency or all remaining depend on failed tables -- force them into a final wave
      waves.push(stillBlocked);
      break;
    }

    waves.push(wave);
    wave.forEach((t) => placed.add(t.name));
    remaining.length = 0;
    remaining.push(...stillBlocked);
  }

  return waves;
}
