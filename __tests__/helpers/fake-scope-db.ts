/**
 * A small, faithful in-memory Prisma fake for the ForgeEstateProgramScope /
 * ForgeEnvironmentScan tables. It is deliberately NOT a call-count spy: it
 * models the real query/update semantics (equality/`in`/`lt` filters, ordered
 * findFirst, conditional `updateMany` returning a `count`, `{ increment }`
 * data ops, `(programId, sequence)` uniqueness) AND runs interactive
 * `$transaction` callbacks under a single serialized lock so we can exercise
 * the production state-machine functions against something that behaves like
 * Serializable isolation.
 */

export interface ScopeRow {
  id: string;
  programId: string;
  label: string;
  ucMetadata: string;
  excludedScope: string | null;
  exclusionPatterns: string | null;
  inclusionPatterns: string | null;
  assetDiscoveryEnabled: boolean;
  lineageDepth: number;
  lineageEnabled: boolean;
  lineageDirection: string;
  workspaceId: string | null;
  teamLabel: string | null;
  status: string;
  scanId: string | null;
  queueJobId: string | null;
  sequence: number;
  errorMessage: string | null;
  attemptCount: number;
  queuedAt: Date | null;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Test-fake convenience: lets the generic where-matcher / data-applier treat
  // a row as a bag of columns without per-field casts.
  [key: string]: unknown;
}

export interface ScanRow {
  scanId: string;
  programId: string | null;
  scanStatus: string;
  finishedAt?: Date | null;
}

type WhereClause = Record<string, unknown>;

function matchOne(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    if ("not" in c) return value !== c.not;
    if ("lt" in c) return (value as number | Date)! < (c.lt as number | Date);
    if ("lte" in c) return (value as number | Date)! <= (c.lte as number | Date);
    if ("gt" in c) return (value as number | Date)! > (c.gt as number | Date);
    if ("gte" in c) return (value as number | Date)! >= (c.gte as number | Date);
    return false;
  }
  return value === cond;
}

function matches(row: Record<string, unknown>, where: WhereClause | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      const ok = (cond as WhereClause[]).some((w) => matches(row, w));
      if (!ok) return false;
      continue;
    }
    if (!matchOne(row[key], cond)) return false;
  }
  return true;
}

function applyData(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !(val instanceof Date) && "increment" in val) {
      row[key] = ((row[key] as number) ?? 0) + (val as { increment: number }).increment;
    } else {
      row[key] = val;
    }
  }
  row.updatedAt = new Date();
}

function sortRows(rows: ScopeRow[], orderBy: unknown): ScopeRow[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses as Array<Record<string, "asc" | "desc">>) {
      for (const [field, dir] of Object.entries(clause)) {
        const av = (a as unknown as Record<string, number>)[field];
        const bv = (b as unknown as Record<string, number>)[field];
        if (av < bv) return dir === "asc" ? -1 : 1;
        if (av > bv) return dir === "asc" ? 1 : -1;
      }
    }
    return 0;
  });
}

let uid = 0;

export class FakeScopeDb {
  scopes: ScopeRow[] = [];
  scans: ScanRow[] = [];
  /** When > 0, the next N `$transaction` calls throw a serialization conflict. */
  failNextTxWithSerialization = 0;
  /** Deterministic interleaving hook: runs after a stale read, immediately
   * before the reclaimer's conditional scope update is evaluated. */
  beforeScopeUpdateMany:
    | ((args: { where?: WhereClause; data: Record<string, unknown> }) => void | Promise<void>)
    | null = null;
  private txLock: Promise<unknown> = Promise.resolve();

  seedScope(partial: Partial<ScopeRow> & { programId: string; sequence: number }): ScopeRow {
    const now = new Date();
    const row: ScopeRow = {
      id: partial.id ?? `scope-${++uid}`,
      programId: partial.programId,
      label: partial.label ?? `Scope ${partial.sequence}`,
      ucMetadata: partial.ucMetadata ?? "cat.schema",
      excludedScope: partial.excludedScope ?? null,
      exclusionPatterns: partial.exclusionPatterns ?? null,
      inclusionPatterns: partial.inclusionPatterns ?? null,
      assetDiscoveryEnabled: partial.assetDiscoveryEnabled ?? false,
      lineageDepth: partial.lineageDepth ?? 5,
      lineageEnabled: partial.lineageEnabled ?? true,
      lineageDirection: partial.lineageDirection ?? "upstream",
      workspaceId: partial.workspaceId ?? null,
      teamLabel: partial.teamLabel ?? null,
      status: partial.status ?? "planned",
      scanId: partial.scanId ?? null,
      queueJobId: partial.queueJobId ?? null,
      sequence: partial.sequence,
      errorMessage: partial.errorMessage ?? null,
      attemptCount: partial.attemptCount ?? 0,
      queuedAt: partial.queuedAt ?? null,
      startedAt: partial.startedAt ?? null,
      heartbeatAt: partial.heartbeatAt ?? null,
      finishedAt: partial.finishedAt ?? null,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now,
    };
    this.scopes.push(row);
    return row;
  }

  get(id: string): ScopeRow | undefined {
    return this.scopes.find((s) => s.id === id);
  }

  private uniqueViolation(programId: string, sequence: number, ignoreId?: string): boolean {
    return this.scopes.some(
      (s) => s.programId === programId && s.sequence === sequence && s.id !== ignoreId,
    );
  }

  private makeP2002(): Error {
    const e = new Error("Unique constraint failed on the fields: (`programId`,`sequence`)") as Error & {
      code: string;
    };
    e.code = "P2002";
    return e;
  }

  private makeSerializationError(): Error {
    const e = new Error("could not serialize access due to concurrent update") as Error & {
      code: string;
    };
    e.code = "P2034";
    return e;
  }

  // --- Prisma-shaped client -------------------------------------------------

  get client() {
    const scopeModel = {
      findFirst: async (args: { where?: WhereClause; orderBy?: unknown } = {}) => {
        const rows = sortRows(
          this.scopes.filter((s) => matches(s, args.where)),
          args.orderBy,
        );
        return rows[0] ? { ...rows[0] } : null;
      },
      findMany: async (args: { where?: WhereClause; orderBy?: unknown } = {}) => {
        const rows = sortRows(
          this.scopes.filter((s) => matches(s, args.where)),
          args.orderBy,
        );
        return rows.map((r) => ({ ...r }));
      },
      count: async (args: { where?: WhereClause } = {}) =>
        this.scopes.filter((s) => matches(s, args.where)).length,
      create: async (args: { data: Record<string, unknown>; select?: unknown }) => {
        const data = args.data;
        const programId = data.programId as string;
        const sequence = data.sequence as number;
        if (this.uniqueViolation(programId, sequence)) throw this.makeP2002();
        const row = this.seedScope({
          ...(data as Partial<ScopeRow>),
          programId,
          sequence,
        } as Partial<ScopeRow> & { programId: string; sequence: number });
        return { ...row };
      },
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        // Validate the whole batch first (against store AND within-batch dups).
        const seen = new Set<string>();
        for (const d of args.data) {
          const key = `${d.programId}::${d.sequence}`;
          if (seen.has(key) || this.uniqueViolation(d.programId as string, d.sequence as number)) {
            throw this.makeP2002();
          }
          seen.add(key);
        }
        for (const d of args.data) {
          this.seedScope({
            ...(d as Partial<ScopeRow>),
            programId: d.programId as string,
            sequence: d.sequence as number,
          } as Partial<ScopeRow> & { programId: string; sequence: number });
        }
        return { count: args.data.length };
      },
      updateMany: async (args: { where?: WhereClause; data: Record<string, unknown> }) => {
        if (this.beforeScopeUpdateMany) {
          const hook = this.beforeScopeUpdateMany;
          this.beforeScopeUpdateMany = null;
          await hook(args);
        }
        const targets = this.scopes.filter((s) => matches(s, args.where));
        for (const t of targets) applyData(t as unknown as Record<string, unknown>, args.data);
        return { count: targets.length };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = this.scopes.find((s) => s.id === args.where.id);
        if (!row) throw new Error("Record to update not found");
        applyData(row as unknown as Record<string, unknown>, args.data);
        return { ...row };
      },
      deleteMany: async (args: { where?: WhereClause }) => {
        const before = this.scopes.length;
        this.scopes = this.scopes.filter((s) => !matches(s, args.where));
        return { count: before - this.scopes.length };
      },
    };

    const scanModel = {
      updateMany: async (args: { where?: WhereClause; data: Record<string, unknown> }) => {
        const targets = this.scans.filter((s) =>
          matches(s as unknown as Record<string, unknown>, args.where),
        );
        for (const target of targets) Object.assign(target, args.data);
        return { count: targets.length };
      },
      update: async (args: { where: { scanId: string }; data: Record<string, unknown> }) => {
        const row = this.scans.find((s) => s.scanId === args.where.scanId);
        if (!row) {
          // attachScanToProgram writes programId onto an existing scan row;
          // create one lazily so the fake tolerates attach-before-seed.
          const created: ScanRow = {
            scanId: args.where.scanId,
            programId: (args.data.programId as string) ?? null,
            scanStatus: "complete",
          };
          this.scans.push(created);
          return { ...created };
        }
        Object.assign(row, args.data);
        return { ...row };
      },
    };

    return {
      forgeEstateProgramScope: scopeModel,
      forgeEnvironmentScan: scanModel,
      $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const run = this.txLock.then(async () => {
          if (this.failNextTxWithSerialization > 0) {
            this.failNextTxWithSerialization -= 1;
            throw this.makeSerializationError();
          }
          return fn(this.client);
        });
        this.txLock = run.catch(() => {});
        return run as Promise<T>;
      },
    };
  }
}
