import { describe, expect, it, vi, beforeEach } from "vitest";
import { sanitizeSpreadsheetString, sanitizeSpreadsheetRow } from "@/lib/export/sanitize-cell";
import { escapeCsvField } from "@/lib/export/csv";

const { mockExecuteSQL, mockMarkProposalsUndone } = vi.hoisted(() => ({
  mockExecuteSQL: vi.fn<(...args: unknown[]) => unknown>(),
  mockMarkProposalsUndone: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}));

vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: (...args: unknown[]) => mockExecuteSQL(...args),
}));

vi.mock("@/lib/lakebase/comment-proposals", () => ({
  markProposalsApplied: vi.fn(async () => undefined),
  markProposalFailed: vi.fn(async () => undefined),
  markProposalsUndone: (...args: unknown[]) => mockMarkProposalsUndone(...args),
}));

vi.mock("@/lib/lakebase/comment-jobs", () => ({
  updateCommentJobStatus: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => {
  const fn = () => undefined;
  const log = { info: fn, warn: fn, debug: fn, error: fn, child: () => log, timed: fn };
  return { logger: log, createScopedLogger: () => log, apiLogger: () => log };
});

import { undoProposals } from "@/lib/ai/comment-applier";
import type { CommentProposal } from "@/lib/lakebase/comment-proposals";

describe("PR-08 spreadsheet formula sanitization & comment undo drift detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spreadsheet formula injection sanitization", () => {
    it("prefixes leading =, +, -, @, tab, and CR characters with a single quote", () => {
      expect(sanitizeSpreadsheetString("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(sanitizeSpreadsheetString("+SUM(A1:A10)")).toBe("'+SUM(A1:A10)");
      expect(sanitizeSpreadsheetString("-1+1")).toBe("'-1+1");
      expect(sanitizeSpreadsheetString("@IMPORTXML()")).toBe("'@IMPORTXML()");
      expect(sanitizeSpreadsheetString("\t=1+1")).toBe("'\t=1+1");
      expect(sanitizeSpreadsheetString("Normal business use case")).toBe(
        "Normal business use case",
      );
    });

    it("preserves numeric values in sanitizeSpreadsheetRow while escaping string formulas", () => {
      const row = sanitizeSpreadsheetRow(['=HYPERLINK("http://evil")', -42.5, "Safe text"]);
      expect(row).toEqual(['\'=HYPERLINK("http://evil")', -42.5, "Safe text"]);
    });

    it("sanitizes formula strings in escapeCsvField and quotes commas/quotes", () => {
      expect(escapeCsvField("=1+1,2")).toBe('"\'=1+1,2"');
      expect(escapeCsvField("@malicious")).toBe("'@malicious");
    });
  });

  describe("undoProposals UC drift detection", () => {
    const sampleTableProposal: CommentProposal = {
      id: "prop-1",
      jobId: "job-1",
      tableFqn: "main.sales.orders",
      columnName: null,
      originalComment: "Original table comment",
      proposedComment: "AI generated table comment",
      editedComment: null,
      status: "applied",
      errorMessage: null,
      appliedAt: new Date("2026-10-27T00:00:00Z"),
      createdAt: new Date("2026-10-27T00:00:00Z"),
    };

    it("skips undo when live UC comment was modified after apply (and force is not set)", async () => {
      const liveComments = new Map<string, string | null>([
        ["main.sales.orders", "Manually curated by Data Steward after apply"],
      ]);

      const res = await undoProposals("job-1", [sampleTableProposal], undefined, undefined, {
        liveComments,
      });

      expect(res.skipped).toBe(1);
      expect(res.applied).toBe(0);
      expect(mockExecuteSQL).not.toHaveBeenCalled();
      expect(mockMarkProposalsUndone).not.toHaveBeenCalled();
    });

    it("proceeds with undo when live UC comment matches the applied comment or force=true", async () => {
      mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });
      const liveComments = new Map<string, string | null>([
        ["main.sales.orders", "Manually curated by Data Steward after apply"],
      ]);

      const res = await undoProposals("job-1", [sampleTableProposal], undefined, undefined, {
        liveComments,
        force: true,
      });

      expect(res.applied).toBe(1);
      expect(res.skipped).toBe(0);
      expect(mockExecuteSQL).toHaveBeenCalledTimes(1);
      expect(mockMarkProposalsUndone).toHaveBeenCalledWith(["prop-1"]);
    });
  });
});
