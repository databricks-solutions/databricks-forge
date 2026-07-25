export type GenieDependentJobOutcome =
  | { status: "completed"; recommendationCount: number }
  | { status: "cancelled" }
  | { status: "failed" | "empty"; error?: string };

export interface PostSqlDependentJobs {
  signal?: AbortSignal;
  runGenie: () => Promise<GenieDependentJobOutcome>;
  runDashboard: () => Promise<void>;
}

type GenieTerminalStatus = "generating" | "completed" | "failed" | "cancelled" | null;

export interface GenieSemanticJob {
  signal?: AbortSignal;
  run: () => Promise<number>;
  completeJob: (recommendationCount: number) => Promise<void>;
  failJob: (error: string) => Promise<void>;
  getTerminalStatus: () => Promise<GenieTerminalStatus>;
  isCancellationError: (error: unknown) => boolean;
}

export async function runGenieSemanticJob({
  signal,
  run,
  completeJob,
  failJob,
  getTerminalStatus,
  isCancellationError,
}: GenieSemanticJob): Promise<GenieDependentJobOutcome> {
  try {
    const recommendationCount = await run();
    if (signal?.aborted) return { status: "cancelled" };
    if (recommendationCount === 0) {
      const error = "Genie semantic stage produced zero persisted domain manifests";
      await failJob(error);
      return { status: "empty", error };
    }

    await completeJob(recommendationCount);
    const terminalStatus = await getTerminalStatus();
    if (terminalStatus !== "completed") {
      return {
        status: terminalStatus === "cancelled" ? "cancelled" : "failed",
      };
    }
    return { status: "completed", recommendationCount };
  } catch (error) {
    if (signal?.aborted || isCancellationError(error)) {
      return { status: "cancelled" };
    }
    const message = error instanceof Error ? error.message : String(error);
    await failJob(message);
    return { status: "failed", error: message };
  }
}

export async function runPostSqlDependentJobs({
  signal,
  runGenie,
  runDashboard,
}: PostSqlDependentJobs): Promise<void> {
  if (signal?.aborted) return;

  const outcome = await runGenie();
  if (signal?.aborted || outcome.status !== "completed" || outcome.recommendationCount === 0) {
    return;
  }

  await runDashboard();
}

export interface SqlDependentJobOutcome {
  generated: number;
  failed: number;
  cancelled: boolean;
}

export async function runBackgroundJobGraph(
  runSql: () => Promise<SqlDependentJobOutcome>,
  runBusinessValue: () => Promise<void>,
  runGenie: () => Promise<GenieDependentJobOutcome>,
  runDashboard: () => Promise<void>,
  includeBusinessValue: boolean,
  genieSignal?: AbortSignal,
): Promise<void> {
  const sqlPromise = Promise.resolve()
    .then(runSql)
    .catch<SqlDependentJobOutcome>(() => ({
      generated: 0,
      failed: 0,
      cancelled: false,
    }));
  const businessValuePromise = includeBusinessValue
    ? Promise.resolve().then(runBusinessValue)
    : Promise.resolve();
  const dependentPromise = sqlPromise.then(async (outcome) => {
    if (outcome.cancelled) return;
    await runPostSqlDependentJobs({
      signal: genieSignal,
      runGenie,
      runDashboard,
    });
  });

  await Promise.allSettled([sqlPromise, businessValuePromise, dependentPromise]);
}
