/**
 * CRUD for Estate Programs and their planned scan sequence.
 *
 * An Estate Program groups many environment scans into one company-level
 * estate (e.g. "Petronas") and owns an ordered list of scan scopes
 * (ForgeEstateProgramScope) that the orchestrator runs in sequence.
 */

import { withPrisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";

export type ScopeStatus =
  | "planned"
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "paused"
  | "cancelled";

/**
 * Maximum times a single scope may be attempted before it is parked as a
 * terminal `failed` (no further automatic retries, no manual retry). Each
 * `claimNextPlannedScope` bumps `attemptCount`; retries and stale-reclaim both
 * respect this ceiling.
 */
export const MAX_SCOPE_ATTEMPTS = 3;

/** How long a queued/running scope may go without a heartbeat before it is
 *  considered abandoned by its worker and eligible for reclaim. */
export const STALE_SCOPE_MS = 5 * 60 * 1000;

/** Thrown when an explicit `sequence` collides with an existing scope in the
 *  same program. Callers should surface this as a 409, not a 500. */
export class DuplicateSequenceError extends Error {
  constructor(message = "A scope with that sequence already exists in this program") {
    super(message);
    this.name = "DuplicateSequenceError";
  }
}

export type RetryScopeResult =
  | { ok: true; scopeId: string }
  | { ok: false; reason: "no_failed_scope" | "active_work" | "max_attempts"; scopeId?: string };

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  ) || (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002");
}

function isSerializationConflict(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2034") return true; // Prisma: transaction failed due to a write conflict / deadlock
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return (
    msg.includes("could not serialize") ||
    msg.includes("deadlock detected") ||
    msg.includes("40001")
  );
}

/**
 * Run `fn` inside a Serializable transaction, retrying a bounded number of
 * times when Postgres aborts it with a serialization/deadlock conflict. This
 * is the ONLY safe way to do read-then-conditional-write claims without a race
 * between the read and the write.
 */
async function runSerializable<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const MAX_TX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_TX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      lastErr = e;
      if (isSerializationConflict(e) && attempt < MAX_TX_ATTEMPTS - 1) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export interface EstateProgramInput {
  name: string;
  description?: string | null;
  industryId?: string | null;
  subVertical?: string | null;
  orgContext?: string | null;
}

export interface ScopeInput {
  label: string;
  ucMetadata: string;
  excludedScope?: string | null;
  exclusionPatterns?: string | null;
  /** Positive include globs (symmetric with exclusionPatterns). */
  inclusionPatterns?: string | null;
  assetDiscoveryEnabled?: boolean;
  lineageDepth?: number;
  lineageEnabled?: boolean;
  lineageDirection?: "upstream" | "both" | "downstream";
  /** Provenance for cross-workspace / cross-team portfolio roll-up (V2). */
  workspaceId?: string | null;
  teamLabel?: string | null;
  sequence?: number;
}

/** Estate-level context threaded into each scope's scan (industry grounding +
 *  org context). Loaded once by the sequence runner before enqueue. */
export interface EstateProgramContext {
  industryId: string | null;
  subVertical: string | null;
  orgContext: string | null;
}

export async function createEstateProgram(
  input: EstateProgramInput,
  ownerEmail: string | null,
): Promise<string> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateProgram.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        industryId: input.industryId ?? null,
        subVertical: input.subVertical ?? null,
        orgContext: input.orgContext ?? null,
        ownerEmail: ownerEmail ? ownerEmail.toLowerCase().trim() : null,
      },
      select: { id: true },
    });
    return row.id;
  });
}

export async function updateEstateProgram(
  programId: string,
  patch: Partial<EstateProgramInput>,
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeEstateProgram.update({
      where: { id: programId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.industryId !== undefined ? { industryId: patch.industryId } : {}),
        ...(patch.subVertical !== undefined ? { subVertical: patch.subVertical } : {}),
        ...(patch.orgContext !== undefined ? { orgContext: patch.orgContext } : {}),
      },
    });
  });
}

/**
 * Count scopes that are mid-flight (`queued` or `running`) for a program. Used
 * to server-enforce the "no delete while a scan is in progress" guard so an
 * in-flight sequence is never orphaned, independent of the client UI.
 */
export async function countActiveProgramScopes(programId: string): Promise<number> {
  return withPrisma(async (prisma) => {
    return prisma.forgeEstateProgramScope.count({
      where: { programId, status: { in: ["queued", "running"] } },
    });
  });
}

export async function deleteEstateProgram(programId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeEstateProgram.delete({ where: { id: programId } });
  });
}

export async function listEstatePrograms(
  ownerEmail?: string | null,
  limit = 50,
  sharedIds: string[] = [],
) {
  return withPrisma(async (prisma) => {
    const normalisedOwner = ownerEmail?.toLowerCase().trim();
    const programs = await prisma.forgeEstateProgram.findMany({
      where: normalisedOwner
        ? {
            OR: [
              { ownerEmail: normalisedOwner },
              { id: { in: sharedIds } },
            ],
          }
        : sharedIds.length > 0
          ? { id: { in: sharedIds } }
          : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { scopes: true, scans: true } } },
    });
    return programs;
  });
}

/** Fetch just the owner email for a program (for ACL guards). Returns
 *  `undefined` when the program does not exist. */
export async function getEstateProgramOwner(
  programId: string,
): Promise<string | null | undefined> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateProgram.findUnique({
      where: { id: programId },
      select: { ownerEmail: true },
    });
    return row ? row.ownerEmail : undefined;
  });
}

/**
 * Fetch just the estate-level context (industry grounding + org context) for a
 * program. Used by the sequence runner to thread industry/subVertical/org into
 * each scope's scan without loading the full scope list. Returns `null` when
 * the program does not exist.
 */
export async function getEstateProgramContext(
  programId: string,
): Promise<EstateProgramContext | null> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeEstateProgram.findUnique({
      where: { id: programId },
      select: { industryId: true, subVertical: true, orgContext: true },
    });
    if (!row) return null;
    return {
      industryId: row.industryId ?? null,
      subVertical: row.subVertical ?? null,
      orgContext: row.orgContext ?? null,
    };
  });
}

/** Get a program with its ordered scopes. */
export async function getEstateProgram(programId: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeEstateProgram.findUnique({
      where: { id: programId },
      include: {
        scopes: { orderBy: { sequence: "asc" } },
      },
    });
  });
}

/**
 * Add one scope to a program's sequence (appended at the end unless an explicit
 * `sequence` is given). Sequence allocation runs inside a Serializable
 * transaction so two concurrent appends can't pick the same next value; an
 * explicit duplicate is rejected cleanly as `DuplicateSequenceError`.
 */
export async function addProgramScope(programId: string, input: ScopeInput): Promise<string> {
  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      let sequence = input.sequence;
      if (sequence === undefined) {
        const last = await tx.forgeEstateProgramScope.findFirst({
          where: { programId },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        sequence = (last?.sequence ?? -1) + 1;
      }
      try {
        const row = await tx.forgeEstateProgramScope.create({
          data: {
            programId,
            label: input.label,
            ucMetadata: input.ucMetadata,
            excludedScope: input.excludedScope ?? null,
            exclusionPatterns: input.exclusionPatterns ?? null,
            inclusionPatterns: input.inclusionPatterns ?? null,
            assetDiscoveryEnabled: input.assetDiscoveryEnabled ?? true,
            lineageDepth: input.lineageDepth ?? 5,
            lineageEnabled: input.lineageEnabled ?? true,
            lineageDirection: input.lineageDirection ?? "upstream",
            workspaceId: input.workspaceId ?? null,
            teamLabel: input.teamLabel ?? null,
            sequence,
            status: "planned",
          },
          select: { id: true },
        });
        return row.id;
      } catch (e) {
        if (isUniqueViolation(e)) throw new DuplicateSequenceError();
        throw e;
      }
    }),
  );
}

/**
 * Bulk add scopes (preserves the order supplied). Contiguous sequences are
 * allocated transactionally from the current max; explicit sequences are
 * honoured but any collision (with existing rows or within the batch) rejects
 * the whole insert as `DuplicateSequenceError`.
 */
export async function addProgramScopes(
  programId: string,
  inputs: ScopeInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      const last = await tx.forgeEstateProgramScope.findFirst({
        where: { programId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      let next = (last?.sequence ?? -1) + 1;
      const data = inputs.map((input) => ({
        programId,
        label: input.label,
        ucMetadata: input.ucMetadata,
        excludedScope: input.excludedScope ?? null,
        exclusionPatterns: input.exclusionPatterns ?? null,
        inclusionPatterns: input.inclusionPatterns ?? null,
        assetDiscoveryEnabled: input.assetDiscoveryEnabled ?? true,
        lineageDepth: input.lineageDepth ?? 5,
        lineageEnabled: input.lineageEnabled ?? true,
        lineageDirection: input.lineageDirection ?? "upstream",
        workspaceId: input.workspaceId ?? null,
        teamLabel: input.teamLabel ?? null,
        sequence: input.sequence ?? next++,
        status: "planned" as const,
      }));
      // Guard against duplicate explicit sequences inside the batch before the
      // DB does (createMany is not atomic per-row across all adapters).
      const seen = new Set<number>();
      for (const d of data) {
        if (seen.has(d.sequence)) throw new DuplicateSequenceError();
        seen.add(d.sequence);
      }
      try {
        const result = await tx.forgeEstateProgramScope.createMany({ data });
        return result.count;
      } catch (e) {
        if (isUniqueViolation(e)) throw new DuplicateSequenceError();
        throw e;
      }
    }),
  );
}

export type DeleteProgramScopeResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "active" };

export async function deleteProgramScope(
  scopeId: string,
  programId: string,
): Promise<DeleteProgramScopeResult> {
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeEstateProgramScope.deleteMany({
      where: {
        id: scopeId,
        programId,
        status: { notIn: ["queued", "running"] },
      },
    });
    if (result.count === 1) return { status: "deleted" };

    const existing = await prisma.forgeEstateProgramScope.findUnique({
      where: { id: scopeId, programId },
      select: { status: true },
    });
    return existing ? { status: "active" } : { status: "not_found" };
  });
}

/** Update a scope's status (and optionally its scanId / errorMessage). */
export async function updateScopeStatus(
  scopeId: string,
  status: ScopeStatus,
  opts: { scanId?: string | null; errorMessage?: string | null } = {},
): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeEstateProgramScope.update({
      where: { id: scopeId },
      data: {
        status,
        ...(opts.scanId !== undefined ? { scanId: opts.scanId } : {}),
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
      },
    });
  });
}

/** The next scope to run for a program (lowest sequence still `planned`). */
export async function getNextPlannedScope(programId: string) {
  return withPrisma(async (prisma) => {
    return prisma.forgeEstateProgramScope.findFirst({
      where: { programId, status: "planned" },
      orderBy: { sequence: "asc" },
    });
  });
}

/**
 * Atomically claim the next runnable scope for a program.
 *
 * Guarantees (all enforced inside ONE Serializable transaction so there is no
 * gap between the read and the conditional write):
 *   1. Only `planned` scopes are claimable. `failed` scopes are NEVER
 *      auto-reclaimed here — a failure requires an explicit `retryFailedScope`.
 *   2. If ANY `queued` or `running` scope already exists for the program, the
 *      claim is refused (returns null) so at most one scope is ever in flight.
 *   3. The lowest-`sequence` planned row wins.
 *
 * On success the row transitions `planned -> queued`, `queuedAt` and the
 * queue lease are stamped, and the run-scoped `scanId` is written (a
 * plain column, no FK, so the UI can poll progress before the scan row exists),
 * and the prior attempt's timestamps are cleared. The attempt is counted only
 * when deferred work actually promotes to `running`, so queue/restart recovery
 * never burns the retry budget. Returns the claimed scope or
 * null (nothing claimable, or another caller won the race).
 */
export async function claimNextPlannedScope(
  programId: string,
  scanId: string,
  queueJobId?: string,
) {
  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      // (2) Never enqueue a second scope while one is queued/running.
      const active = await tx.forgeEstateProgramScope.count({
        where: { programId, status: { in: ["queued", "running"] } },
      });
      if (active > 0) return null;

      // (1)+(3) Lowest-sequence planned scope only.
      const candidate = await tx.forgeEstateProgramScope.findFirst({
        where: { programId, status: "planned", attemptCount: { lt: MAX_SCOPE_ATTEMPTS } },
        orderBy: { sequence: "asc" },
      });
      if (!candidate) return null;

      const claimed = await tx.forgeEstateProgramScope.updateMany({
        where: { id: candidate.id, status: "planned" },
        data: {
          status: "queued",
          scanId,
          queueJobId: queueJobId ?? null,
          errorMessage: null,
          queuedAt: new Date(),
          startedAt: null,
          heartbeatAt: new Date(),
          finishedAt: null,
        },
      });
      if (claimed.count !== 1) return null; // lost the race; caller retries/aborts

      return {
        ...candidate,
        status: "queued",
        scanId,
        queueJobId: queueJobId ?? null,
      };
    }),
  );
}

/**
 * Explicitly retry ONE `failed` scope: move it back to `planned` so the next
 * `Run` claims it. Only permitted when (a) no other scope is queued/running for
 * the program (no active-work conflict) and (b) the scope has attempts left
 * (`attemptCount < MAX_SCOPE_ATTEMPTS`). `attemptCount` is preserved so the
 * retry budget keeps shrinking across successive retries.
 *
 * Pass `scopeId` to target a specific failure; otherwise the lowest-sequence
 * failed scope is chosen.
 */
export async function retryFailedScope(
  programId: string,
  scopeId?: string,
): Promise<RetryScopeResult> {
  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      const active = await tx.forgeEstateProgramScope.count({
        where: { programId, status: { in: ["queued", "running"] } },
      });
      if (active > 0) return { ok: false, reason: "active_work" } as const;

      const candidate = await tx.forgeEstateProgramScope.findFirst({
        where: scopeId
          ? { id: scopeId, programId, status: "failed" }
          : { programId, status: "failed" },
        orderBy: { sequence: "asc" },
      });
      if (!candidate) return { ok: false, reason: "no_failed_scope" } as const;

      if (candidate.attemptCount >= MAX_SCOPE_ATTEMPTS) {
        return { ok: false, reason: "max_attempts", scopeId: candidate.id } as const;
      }

      const updated = await tx.forgeEstateProgramScope.updateMany({
        where: { id: candidate.id, status: "failed" },
        data: {
          status: "planned",
          scanId: null,
          queueJobId: null,
          errorMessage: null,
          queuedAt: null,
          startedAt: null,
          heartbeatAt: null,
          finishedAt: null,
        },
      });
      if (updated.count !== 1) return { ok: false, reason: "active_work" } as const;

      return { ok: true, scopeId: candidate.id } as const;
    }),
  );
}

/**
 * Conditionally promote a claimed scope `queued -> running`. This is the
 * deferred job's FIRST action: it only succeeds when the row is still `queued`
 * with the same `scanId`. If pause/cancel/retry/recovery changed the status (or
 * a newer attempt replaced the scanId) it returns false and the caller must
 * exit without scanning. Stamps `startedAt` + `heartbeatAt`.
 */
export async function promoteQueuedToRunning(
  scopeId: string,
  scanId: string,
  queueJobId?: string,
): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const now = new Date();
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: {
        id: scopeId,
        scanId,
        status: "queued",
        ...(queueJobId ? { queueJobId } : {}),
        attemptCount: { lt: MAX_SCOPE_ATTEMPTS },
      },
      data: {
        status: "running",
        queueJobId: null,
        startedAt: now,
        heartbeatAt: now,
        attemptCount: { increment: 1 },
      },
    });
    return res.count === 1;
  });
}

/** Refresh the lease for a scope still waiting in the deferred queue. */
export async function heartbeatQueuedScope(
  scopeId: string,
  scanId: string,
  queueJobId: string,
): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { id: scopeId, scanId, queueJobId, status: "queued" },
      data: { heartbeatAt: new Date() },
    });
    return res.count === 1;
  });
}

/**
 * Refresh a running scope's heartbeat. No-op (returns false) unless the row is
 * still `running` under the same `scanId`, so a zombie worker can't resurrect a
 * reclaimed/superseded attempt. Best-effort; called periodically during a scan.
 */
export async function heartbeatScope(scopeId: string, scanId: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { id: scopeId, scanId, status: "running" },
      data: { heartbeatAt: new Date() },
    });
    return res.count === 1;
  });
}

/**
 * Conditionally finish a scope `running -> complete`. Only succeeds when the row
 * is still `running` under the SAME `scanId`; a late completion from a
 * superseded attempt (whose scanId no longer matches) is ignored. Returns
 * whether the transition applied — callers gate scan attachment on this.
 */
export async function completeScope(scopeId: string, scanId: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { id: scopeId, scanId, status: "running" },
      data: { status: "complete", finishedAt: new Date(), errorMessage: null },
    });
    return res.count === 1;
  });
}

/**
 * Atomically complete a scope AND expose its fully-written scan to estate
 * readers. Program scans remain `scanStatus=running` throughout enrichment;
 * this transaction is the sole transition that both attaches the scan and
 * marks it complete. If the scope's scanId/status guard loses to a newer
 * attempt, the old scan is marked failed so owner-wide aggregates exclude it.
 */
export async function completeScopeAndFinalizeScan(
  scopeId: string,
  scanId: string,
  programId: string,
): Promise<boolean> {
  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      const completed = await tx.forgeEstateProgramScope.updateMany({
        where: { id: scopeId, programId, scanId, status: "running" },
        data: { status: "complete", finishedAt: new Date(), errorMessage: null },
      });
      if (completed.count !== 1) {
        await tx.forgeEnvironmentScan.updateMany({
          where: { scanId },
          data: { scanStatus: "failed", finishedAt: new Date() },
        });
        return false;
      }

      const finalized = await tx.forgeEnvironmentScan.updateMany({
        where: { scanId, scanStatus: "running" },
        data: { programId, scanStatus: "complete", finishedAt: new Date() },
      });
      if (finalized.count !== 1) {
        throw new Error(`Scan ${scanId} was not available for finalization`);
      }
      return true;
    }),
  );
}

/**
 * Conditionally fail a scope `running -> failed`. Same scanId + running guard as
 * `completeScope`, so a stale worker's late error cannot clobber a newer
 * attempt. Returns whether the transition applied.
 */
export async function failScope(
  scopeId: string,
  scanId: string,
  errorMessage: string,
): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { id: scopeId, scanId, status: "running" },
      data: { status: "failed", finishedAt: new Date(), errorMessage },
    });
    return res.count === 1;
  });
}

/**
 * Pause a sequence: move all not-yet-running scopes (`planned`/`queued`) to
 * `paused` so the claimer skips them. A currently `running` scope finishes.
 * Returns the number of scopes paused.
 */
export async function pauseScopes(programId: string): Promise<number> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { programId, status: { in: ["planned", "queued"] } },
      data: { status: "paused" },
    });
    return res.count;
  });
}

/** Resume a paused sequence: flip `paused` scopes back to `planned`. */
export async function resumeScopes(programId: string): Promise<number> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { programId, status: "paused" },
      data: { status: "planned" },
    });
    return res.count;
  });
}

/**
 * Cancel a sequence: terminally mark all not-yet-complete, not-running scopes
 * (`planned`/`queued`/`paused`/`failed`) as `cancelled`. A `running` scope is
 * left to finish (its result still attaches). Returns the count cancelled.
 */
export async function cancelScopes(programId: string): Promise<number> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeEstateProgramScope.updateMany({
      where: { programId, status: { in: ["planned", "queued", "paused", "failed"] } },
      data: { status: "cancelled" },
    });
    return res.count;
  });
}

/**
 * Reclaim stale scopes whose worker has gone away — covering BOTH `queued`
 * scopes that never started (crash between claim and promote) AND `running`
 * scopes whose heartbeat has died (the process running the scan is gone). A
 * scope is stale when its liveness timestamp is older than `olderThanMs`:
 *   - queued  -> `queuedAt` (falls back to `updatedAt`)
 *   - running -> `heartbeatAt` (falls back to `startedAt`, then `updatedAt`)
 *
 * A stale scope with attempts remaining is reset to `planned` (scanId, queue
 * identity, and timestamps cleared) so the next `Run` re-claims it under a FRESH scanId — the
 * cleared scanId is precisely what makes any late completion from the old
 * worker a no-op (see `completeScope`/`failScope`). A scope that has exhausted
 * `MAX_SCOPE_ATTEMPTS` is parked as terminal `failed` instead.
 *
 * Each transition is a conditional `updateMany` matched on id + prior status +
 * prior scanId, so if the job actually finished between the scan and the write,
 * nothing is clobbered. A stale RUNNING job cannot be killed in-process; this
 * guard is what guarantees its eventual late write cannot overwrite a newer
 * attempt.
 */
export async function reclaimStaleScopes(
  programId: string,
  opts: { olderThanMs?: number; now?: number } = {},
): Promise<{ reclaimed: number; failed: number }> {
  const olderThanMs = opts.olderThanMs ?? STALE_SCOPE_MS;
  const nowMs = opts.now ?? Date.now();
  const cutoff = nowMs - olderThanMs;

  return withPrisma((prisma) =>
    runSerializable(prisma, async (tx) => {
      const candidates = await tx.forgeEstateProgramScope.findMany({
        where: { programId, status: { in: ["queued", "running"] } },
      });

      let reclaimed = 0;
      let failed = 0;

      for (const c of candidates) {
        const liveness =
          c.status === "running"
            ? (c.heartbeatAt ?? c.startedAt ?? c.updatedAt)
            : (c.heartbeatAt ?? c.queuedAt ?? c.updatedAt);
        if (!liveness || liveness.getTime() >= cutoff) continue; // still fresh

        // Compare-and-swap every observed lease component, including explicit
        // nulls. If a queue/running heartbeat commits after this stale read,
        // heartbeatAt (and updatedAt in Postgres) no longer match and the
        // reclaim becomes a no-op. queueJobId + scanId prevent an old worker's
        // observation from touching a newly claimed attempt.
        const observedLease = {
          id: c.id,
          programId,
          status: c.status,
          scanId: c.scanId,
          queueJobId: c.queueJobId,
          heartbeatAt: c.heartbeatAt,
          queuedAt: c.queuedAt,
          startedAt: c.startedAt,
          updatedAt: c.updatedAt,
        };

        const res =
          c.attemptCount < MAX_SCOPE_ATTEMPTS
            ? await tx.forgeEstateProgramScope.updateMany({
                where: observedLease,
                data: {
                  status: "planned",
                  scanId: null,
                  queueJobId: null,
                  queuedAt: null,
                  startedAt: null,
                  heartbeatAt: null,
                  finishedAt: null,
                  errorMessage: null,
                },
              })
            : await tx.forgeEstateProgramScope.updateMany({
                where: observedLease,
                data: {
                  status: "failed",
                  queueJobId: null,
                  finishedAt: new Date(nowMs),
                  errorMessage: "Reclaimed: worker heartbeat expired after max attempts",
                },
              });

        if (res.count !== 1) continue;

        if (c.attemptCount < MAX_SCOPE_ATTEMPTS) reclaimed += 1;
        else failed += 1;

        // A running attempt may already have written a hidden checkpoint.
        // Retire it in the SAME transaction as the scope transition so it can
        // never later appear in owner-wide aggregates.
        if (c.status === "running" && c.scanId) {
          await tx.forgeEnvironmentScan.updateMany({
            where: { scanId: c.scanId, scanStatus: "running" },
            data: { scanStatus: "failed", finishedAt: new Date(nowMs) },
          });
        }
      }

      return { reclaimed, failed };
    }),
  );
}

/** Attach a completed scan to a program (sets ForgeEnvironmentScan.programId). */
export async function attachScanToProgram(scanId: string, programId: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeEnvironmentScan.update({
      where: { scanId },
      data: { programId },
    });
  });
}
