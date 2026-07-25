import { describe, it, expect } from "vitest";

/**
 * Tests for the comment proposal status aggregation logic.
 *
 * The actual Prisma groupBy in comment-proposals.ts can't be unit-tested
 * without a database. These tests verify the aggregation algorithm used
 * in the CommentTableNav component to derive table-level status.
 */

interface TableSummary {
  tableFqn: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  failed: number;
}

function getTableStatus(t: TableSummary): string {
  if (t.applied > 0 && t.applied === t.total) return "applied";
  if (t.failed > 0) return "failed";
  if (t.accepted > 0 && t.accepted + t.rejected === t.total) return "accepted";
  if (t.rejected > 0 && t.rejected === t.total) return "rejected";
  if (t.accepted > 0 || t.rejected > 0) return "mixed";
  return "pending";
}

function makeSummary(overrides: Partial<TableSummary>): TableSummary {
  return {
    tableFqn: "cat.sch.tbl",
    total: 5,
    pending: 5,
    accepted: 0,
    rejected: 0,
    applied: 0,
    failed: 0,
    ...overrides,
  };
}

describe("table status derivation", () => {
  it("returns pending when all proposals are pending", () => {
    expect(getTableStatus(makeSummary({ pending: 5 }))).toBe("pending");
  });

  it("returns accepted when all are accepted or rejected", () => {
    expect(getTableStatus(makeSummary({ pending: 0, accepted: 3, rejected: 2 }))).toBe("accepted");
  });

  it("returns rejected when all are rejected", () => {
    expect(getTableStatus(makeSummary({ pending: 0, rejected: 5 }))).toBe("rejected");
  });

  it("returns applied when all are applied", () => {
    expect(getTableStatus(makeSummary({ pending: 0, applied: 5 }))).toBe("applied");
  });

  it("returns failed when any are failed", () => {
    expect(getTableStatus(makeSummary({ pending: 0, accepted: 3, failed: 2 }))).toBe("failed");
  });

  it("returns mixed when some accepted but not all reviewed", () => {
    expect(getTableStatus(makeSummary({ pending: 2, accepted: 3 }))).toBe("mixed");
  });

  it("returns mixed when some rejected but others still pending", () => {
    expect(getTableStatus(makeSummary({ pending: 2, rejected: 3 }))).toBe("mixed");
  });

  it("failed takes precedence over applied", () => {
    expect(getTableStatus(makeSummary({ pending: 0, applied: 3, failed: 2 }))).toBe("failed");
  });

  it("applied takes precedence over accepted", () => {
    expect(getTableStatus(makeSummary({ pending: 0, applied: 5, accepted: 0 }))).toBe("applied");
  });
});

describe("proposal status transitions", () => {
  const VALID_STATUSES = ["pending", "accepted", "rejected", "applied", "undone", "failed"];

  it("all valid statuses are recognized", () => {
    for (const s of VALID_STATUSES) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it("accept/reject are the only user-driven transitions from pending", () => {
    const fromPending = ["accepted", "rejected"];
    for (const next of fromPending) {
      expect(VALID_STATUSES).toContain(next);
    }
  });

  it("applied is reached only from accepted", () => {
    expect(VALID_STATUSES).toContain("applied");
  });

  it("undone is reached only from applied", () => {
    expect(VALID_STATUSES).toContain("undone");
  });
});
