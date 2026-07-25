import { describe, expect, it } from "vitest";
import { runBackgroundJobGraph as runOrchestration } from "@/lib/pipeline/background-job-orchestration";

/**
 * Documents and locks in the background-job sequencing contract introduced
 * in the async-SQL refactor. These tests invoke the production
 * `runBackgroundJobGraph` helper used by `lib/pipeline/engine.ts`.
 *
 * The invariants this test enforces:
 *   1. SQL must START before Genie or Dashboard start.
 *   2. SQL must FINISH before Genie or Dashboard start (gating).
 *   3. BV starts in parallel with SQL — it does NOT wait for SQL.
 *   4. SQL failure does NOT block Genie/Dashboard (gating is by resolution,
 *      not success), so the dependent chain still fires on partial SQL.
 *   5. SQL CANCELLATION DOES block Genie/Dashboard — the user clicked
 *      cancel, so running expensive downstream work on a half-empty
 *      dataset contradicts that intent.
 *
 * The test exercises real Promises rather than mocking the engine itself
 * so the wiring is validated end-to-end and remains brittle to regressions.
 */

interface ExecOrder {
  events: string[];
  push(name: string): void;
}

function recorder(): ExecOrder {
  const events: string[] = [];
  return {
    events,
    push(name: string) {
      events.push(name);
    },
  };
}

type SqlOutcome = { generated: number; failed: number; cancelled: boolean };

function delayedTask(
  rec: ExecOrder,
  name: string,
  delayMs: number,
  options: { fail?: boolean } = {},
): () => Promise<void> {
  return async () => {
    rec.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, delayMs));
    rec.push(`${name}:end`);
    if (options.fail) throw new Error(`${name} failed`);
  };
}

function delayedSqlTask(
  rec: ExecOrder,
  delayMs: number,
  options: { fail?: boolean; cancelled?: boolean } = {},
): () => Promise<SqlOutcome> {
  return async () => {
    rec.push("sql:start");
    await new Promise((r) => setTimeout(r, delayMs));
    rec.push("sql:end");
    if (options.fail) throw new Error("sql failed");
    return {
      generated: options.cancelled ? 0 : 1,
      failed: 0,
      cancelled: options.cancelled === true,
    };
  };
}

describe("background-job orchestration (SQL gates Genie/Dashboard, BV parallel)", () => {
  it("Genie and Dashboard do not start until SQL has resolved", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 30),
      delayedTask(rec, "bv", 30),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    const sqlEnd = rec.events.indexOf("sql:end");
    const genieStart = rec.events.indexOf("genie:start");
    const dashStart = rec.events.indexOf("dashboard:start");

    expect(sqlEnd).toBeGreaterThanOrEqual(0);
    expect(genieStart).toBeGreaterThan(sqlEnd);
    expect(dashStart).toBeGreaterThan(sqlEnd);
  });

  it("BV starts in parallel with SQL (not after)", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 50),
      delayedTask(rec, "bv", 5),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    const sqlStart = rec.events.indexOf("sql:start");
    const bvStart = rec.events.indexOf("bv:start");
    const sqlEnd = rec.events.indexOf("sql:end");

    expect(sqlStart).toBeGreaterThanOrEqual(0);
    expect(bvStart).toBeGreaterThanOrEqual(0);
    // BV must start before SQL ends — this is the parallel contract.
    expect(bvStart).toBeLessThan(sqlEnd);
  });

  it("Dashboard starts only after Genie finishes", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 10),
      delayedTask(rec, "bv", 0),
      async () => {
        await delayedTask(rec, "genie", 40)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    const genieStart = rec.events.indexOf("genie:start");
    const dashStart = rec.events.indexOf("dashboard:start");
    const genieEnd = rec.events.indexOf("genie:end");
    expect(dashStart).toBeGreaterThan(genieEnd);
  });

  it("SQL failure still releases the gate so Genie and Dashboard fire (partial SQL is usable)", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 10, { fail: true }),
      delayedTask(rec, "bv", 0),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    expect(rec.events).toContain("genie:start");
    expect(rec.events).toContain("dashboard:start");
    expect(rec.events).toContain("genie:end");
    expect(rec.events).toContain("dashboard:end");
  });

  it("SQL cancellation blocks Genie and Dashboard (honor user stop intent)", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 10, { cancelled: true }),
      delayedTask(rec, "bv", 0),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    // SQL ran (and was cancelled mid-flight in the real flow); BV still runs.
    expect(rec.events).toContain("sql:end");
    expect(rec.events).toContain("bv:end");
    // Genie and Dashboard MUST NOT fire — user clicked cancel.
    expect(rec.events).not.toContain("genie:start");
    expect(rec.events).not.toContain("dashboard:start");
    expect(rec.events).not.toContain("genie:end");
    expect(rec.events).not.toContain("dashboard:end");
  });

  it("SQL cancellation does NOT block BV (BV has no SQL dependency)", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 20, { cancelled: true }),
      delayedTask(rec, "bv", 10),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      true,
    );

    expect(rec.events).toContain("bv:start");
    expect(rec.events).toContain("bv:end");
    expect(rec.events).not.toContain("genie:start");
    expect(rec.events).not.toContain("dashboard:start");
  });

  it("includeBv=false skips the BV task entirely", async () => {
    const rec = recorder();
    await runOrchestration(
      delayedSqlTask(rec, 5),
      delayedTask(rec, "bv", 5),
      async () => {
        await delayedTask(rec, "genie", 5)();
        return { status: "completed" as const, recommendationCount: 1 };
      },
      delayedTask(rec, "dashboard", 5),
      false,
    );

    expect(rec.events).not.toContain("bv:start");
    expect(rec.events).not.toContain("bv:end");
    // SQL, Genie, Dashboard still fire.
    expect(rec.events).toContain("sql:end");
    expect(rec.events).toContain("genie:end");
    expect(rec.events).toContain("dashboard:end");
  });

  it("settles branch failures without an unhandled top-level rejection", async () => {
    await expect(
      runOrchestration(
        async () => ({ generated: 1, failed: 0, cancelled: false }),
        () => {
          throw new Error("BV status wrapper failed");
        },
        async () => ({ status: "completed", recommendationCount: 1 }),
        async () => {
          throw new Error("Dashboard status wrapper failed");
        },
        true,
      ),
    ).resolves.toBeUndefined();
  });
});
