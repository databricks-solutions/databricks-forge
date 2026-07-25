import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dbx/sql", () => ({
  executeSQL: vi.fn(),
}));

vi.mock("@/lib/lakebase/comment-proposals", () => ({
  markProposalsApplied: vi.fn(() => Promise.resolve()),
  markProposalFailed: vi.fn(() => Promise.resolve()),
  markProposalsUndone: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/lakebase/comment-jobs", () => ({
  updateCommentJobStatus: vi.fn(),
}));

const _mockApplierLog = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
  timed: vi.fn(),
  context: {},
};
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createScopedLogger: () => _mockApplierLog,
  apiLogger: () => _mockApplierLog,
}));

import { executeSQL } from "@/lib/dbx/sql";
import {
  escapeComment,
  validateCommentText,
  buildTableCommentDDL,
  buildColumnCommentDDL,
  buildBatchColumnCommentDDL,
  supportsColumnComments,
  checkPermissions,
  applyProposals,
  undoProposals,
} from "@/lib/ai/comment-applier";
import type { CommentProposal } from "@/lib/lakebase/comment-proposals";
import { markProposalsApplied, markProposalFailed } from "@/lib/lakebase/comment-proposals";

const mockExecuteSQL = vi.mocked(executeSQL);
const mockMarkApplied = vi.mocked(markProposalsApplied);
const mockMarkFailed = vi.mocked(markProposalFailed);

beforeEach(() => {
  vi.resetAllMocks();
  // Re-apply default resolved values after reset
  mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });
});

// ---------------------------------------------------------------------------
// escapeComment
// ---------------------------------------------------------------------------

describe("escapeComment", () => {
  it("doubles single quotes", () => {
    expect(escapeComment("it's a test")).toBe("it''s a test");
  });

  it("handles multiple quotes", () => {
    expect(escapeComment("it's John's table")).toBe("it''s John''s table");
  });

  it("leaves strings without quotes unchanged", () => {
    expect(escapeComment("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(escapeComment("")).toBe("");
  });

  it("handles backticks (no escaping needed in string literals)", () => {
    expect(escapeComment("uses `backticks`")).toBe("uses `backticks`");
  });

  it("handles unicode", () => {
    expect(escapeComment("表の説明")).toBe("表の説明");
  });

  it("rejects SQL injection attempt with DROP TABLE", () => {
    expect(() => escapeComment("'; DROP TABLE foo; --")).toThrow("disallowed SQL pattern");
  });

  it("strips NUL bytes", () => {
    expect(escapeComment("before\x00after")).toBe("beforeafter");
  });

  it("strips control characters but preserves tabs and newlines", () => {
    expect(escapeComment("line1\nline2\ttab")).toBe("line1\nline2\ttab");
    expect(escapeComment("has\x01control\x0Echars")).toBe("hascontrolchars");
  });

  it("throws on comments exceeding 4000 characters", () => {
    expect(() => escapeComment("x".repeat(4001))).toThrow("exceeds maximum length");
  });

  it("accepts exactly 4000 characters", () => {
    expect(() => escapeComment("x".repeat(4000))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateCommentText -- destructive SQL blocklist
// ---------------------------------------------------------------------------

describe("validateCommentText", () => {
  // --- Should be rejected ---

  it("rejects DROP TABLE", () => {
    expect(() => validateCommentText("DROP TABLE foo")).toThrow("disallowed SQL pattern");
  });

  it("rejects DROP VIEW", () => {
    expect(() => validateCommentText("DROP VIEW my_view")).toThrow("disallowed SQL pattern");
  });

  it("rejects DROP SCHEMA", () => {
    expect(() => validateCommentText("DROP SCHEMA public")).toThrow("disallowed SQL pattern");
  });

  it("rejects DROP DATABASE", () => {
    expect(() => validateCommentText("DROP DATABASE prod")).toThrow("disallowed SQL pattern");
  });

  it("rejects DROP FUNCTION", () => {
    expect(() => validateCommentText("DROP FUNCTION my_udf")).toThrow("disallowed SQL pattern");
  });

  it("rejects TRUNCATE TABLE", () => {
    expect(() => validateCommentText("TRUNCATE TABLE orders")).toThrow("disallowed SQL pattern");
  });

  it("rejects bare TRUNCATE", () => {
    expect(() => validateCommentText("TRUNCATE orders")).toThrow("disallowed SQL pattern");
  });

  it("rejects DELETE FROM", () => {
    expect(() => validateCommentText("DELETE FROM users WHERE id=1")).toThrow(
      "disallowed SQL pattern",
    );
  });

  it("rejects INSERT INTO", () => {
    expect(() => validateCommentText("INSERT INTO users VALUES (1)")).toThrow(
      "disallowed SQL pattern",
    );
  });

  it("rejects UPDATE SET", () => {
    expect(() => validateCommentText("UPDATE users SET name='x'")).toThrow(
      "disallowed SQL pattern",
    );
  });

  it("rejects ALTER TABLE", () => {
    expect(() => validateCommentText("ALTER TABLE users ADD COLUMN")).toThrow(
      "disallowed SQL pattern",
    );
  });

  it("rejects CREATE TABLE", () => {
    expect(() => validateCommentText("CREATE TABLE evil")).toThrow("disallowed SQL pattern");
  });

  it("rejects GRANT ON", () => {
    expect(() => validateCommentText("GRANT SELECT ON users")).toThrow("disallowed SQL pattern");
  });

  it("rejects REVOKE FROM", () => {
    expect(() => validateCommentText("REVOKE SELECT FROM user")).toThrow("disallowed SQL pattern");
  });

  it("rejects EXEC()", () => {
    expect(() => validateCommentText("EXEC(something)")).toThrow("disallowed SQL pattern");
  });

  it("rejects EXECUTE()", () => {
    expect(() => validateCommentText("EXECUTE(something)")).toThrow("disallowed SQL pattern");
  });

  it("rejects CALL procedure()", () => {
    expect(() => validateCommentText("CALL my_proc()")).toThrow("disallowed SQL pattern");
  });

  it("rejects semicolon followed by destructive keyword", () => {
    expect(() => validateCommentText("safe text; DROP something")).toThrow(
      "disallowed SQL pattern",
    );
  });

  it("is case-insensitive", () => {
    expect(() => validateCommentText("drop table foo")).toThrow("disallowed SQL pattern");
    expect(() => validateCommentText("Drop Table Foo")).toThrow("disallowed SQL pattern");
  });

  // --- Should be allowed (legitimate business language) ---

  it("allows 'drop' as a standalone word", () => {
    expect(() => validateCommentText("Tracks customer drop rate")).not.toThrow();
  });

  it("allows 'drop-off' in hyphenated context", () => {
    expect(() => validateCommentText("Measures basket drop-off by funnel stage")).not.toThrow();
  });

  it("allows 'delete' as a standalone word", () => {
    expect(() => validateCommentText("Soft delete flag for GDPR compliance")).not.toThrow();
  });

  it("allows 'truncated' as an adjective", () => {
    expect(() => validateCommentText("Truncated name field for display purposes")).not.toThrow();
  });

  it("allows 'insert' as a standalone word", () => {
    expect(() => validateCommentText("Timestamp of last insert")).not.toThrow();
  });

  it("allows 'update' as a standalone word", () => {
    expect(() => validateCommentText("Last update timestamp")).not.toThrow();
  });

  it("allows 'grant' as a standalone word", () => {
    expect(() => validateCommentText("Grant application tracking table")).not.toThrow();
  });

  it("allows 'create' as a standalone word", () => {
    expect(() => validateCommentText("Stores create and modify timestamps")).not.toThrow();
  });

  it("allows normal business descriptions", () => {
    expect(() => validateCommentText("Monthly revenue by product line in USD")).not.toThrow();
    expect(() => validateCommentText("Customer's lifetime value score")).not.toThrow();
    expect(() => validateCommentText("Tracks order status from placed to delivered")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildTableCommentDDL
// ---------------------------------------------------------------------------

describe("buildTableCommentDDL", () => {
  it("builds COMMENT ON TABLE with backtick-quoted FQN", () => {
    const ddl = buildTableCommentDDL("cat.sch.tbl", "A description");
    expect(ddl).toBe("COMMENT ON TABLE `cat`.`sch`.`tbl` IS 'A description'");
  });

  it("escapes single quotes in the comment", () => {
    const ddl = buildTableCommentDDL("cat.sch.tbl", "it's great");
    expect(ddl).toBe("COMMENT ON TABLE `cat`.`sch`.`tbl` IS 'it''s great'");
  });

  it("produces IS NULL for null comment", () => {
    const ddl = buildTableCommentDDL("cat.sch.tbl", null);
    expect(ddl).toBe("COMMENT ON TABLE `cat`.`sch`.`tbl` IS NULL");
  });

  it("produces empty string comment (not NULL) for empty string", () => {
    const ddl = buildTableCommentDDL("cat.sch.tbl", "");
    expect(ddl).toBe("COMMENT ON TABLE `cat`.`sch`.`tbl` IS ''");
  });

  it("throws on invalid FQN", () => {
    expect(() => buildTableCommentDDL("", "desc")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildColumnCommentDDL
// ---------------------------------------------------------------------------

describe("buildColumnCommentDDL", () => {
  it("builds ALTER TABLE for Delta tables (default)", () => {
    const ddl = buildColumnCommentDDL("cat.sch.tbl", "col1", "A column");
    expect(ddl).toBe("ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT 'A column'");
  });

  it("builds ALTER TABLE for MANAGED type", () => {
    const ddl = buildColumnCommentDDL("cat.sch.tbl", "col1", "desc", "MANAGED");
    expect(ddl).toBe("ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT 'desc'");
  });

  it("builds ALTER VIEW for VIEW type", () => {
    const ddl = buildColumnCommentDDL("cat.sch.v1", "col1", "desc", "VIEW");
    expect(ddl).toBe("ALTER VIEW `cat`.`sch`.`v1` ALTER COLUMN `col1` COMMENT 'desc'");
  });

  it("builds ALTER VIEW for MATERIALIZED_VIEW type", () => {
    const ddl = buildColumnCommentDDL("cat.sch.mv1", "col1", "desc", "MATERIALIZED_VIEW");
    expect(ddl).toBe("ALTER VIEW `cat`.`sch`.`mv1` ALTER COLUMN `col1` COMMENT 'desc'");
  });

  it("produces empty string for null comment (not NULL)", () => {
    const ddl = buildColumnCommentDDL("cat.sch.tbl", "col1", null);
    expect(ddl).toBe("ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT ''");
  });

  it("escapes quotes in column comments", () => {
    const ddl = buildColumnCommentDDL("cat.sch.tbl", "col1", "it's a key");
    expect(ddl).toBe("ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT 'it''s a key'");
  });

  it("throws on invalid column name", () => {
    expect(() => buildColumnCommentDDL("cat.sch.tbl", "", "desc")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// supportsColumnComments
// ---------------------------------------------------------------------------

describe("supportsColumnComments", () => {
  it("returns true for MANAGED", () => {
    expect(supportsColumnComments("MANAGED")).toBe(true);
  });

  it("returns true for EXTERNAL", () => {
    expect(supportsColumnComments("EXTERNAL")).toBe(true);
  });

  it("returns true for DELTA", () => {
    expect(supportsColumnComments("DELTA")).toBe(true);
  });

  it("returns true for VIEW", () => {
    expect(supportsColumnComments("VIEW")).toBe(true);
  });

  it("returns true for MATERIALIZED_VIEW", () => {
    expect(supportsColumnComments("MATERIALIZED_VIEW")).toBe(true);
  });

  it("returns false for CSV", () => {
    expect(supportsColumnComments("CSV")).toBe(false);
  });

  it("returns false for JSON", () => {
    expect(supportsColumnComments("JSON")).toBe(false);
  });

  it("returns false for PARQUET", () => {
    expect(supportsColumnComments("PARQUET")).toBe(false);
  });

  it("returns true for null (optimistic default)", () => {
    expect(supportsColumnComments(null)).toBe(true);
  });

  it("returns true for undefined (optimistic default)", () => {
    expect(supportsColumnComments(undefined)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(supportsColumnComments("managed")).toBe(true);
    expect(supportsColumnComments("View")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBatchColumnCommentDDL
// ---------------------------------------------------------------------------

describe("buildBatchColumnCommentDDL", () => {
  it("builds multi-column ALTER TABLE for Delta tables", () => {
    const result = buildBatchColumnCommentDDL("cat.sch.tbl", [
      { columnName: "col1", comment: "First column" },
      { columnName: "col2", comment: "Second column" },
    ]);
    expect(result).toBe(
      "ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT 'First column', `col2` COMMENT 'Second column'",
    );
  });

  it("builds ALTER VIEW for view types", () => {
    const result = buildBatchColumnCommentDDL(
      "cat.sch.v1",
      [
        { columnName: "a", comment: "A col" },
        { columnName: "b", comment: "B col" },
      ],
      "VIEW",
    );
    expect(result).toContain("ALTER VIEW");
  });

  it("falls back to single-column DDL for one column", () => {
    const result = buildBatchColumnCommentDDL("cat.sch.tbl", [
      { columnName: "col1", comment: "Only column" },
    ]);
    expect(result).toBe("ALTER TABLE `cat`.`sch`.`tbl` ALTER COLUMN `col1` COMMENT 'Only column'");
  });

  it("escapes quotes in comments", () => {
    const result = buildBatchColumnCommentDDL("cat.sch.tbl", [
      { columnName: "col1", comment: "it's a test" },
      { columnName: "col2", comment: "normal" },
    ]);
    expect(result).toContain("it''s a test");
  });

  it("uses empty string for null comments", () => {
    const result = buildBatchColumnCommentDDL("cat.sch.tbl", [
      { columnName: "col1", comment: null },
    ]);
    expect(result).toContain("COMMENT ''");
  });

  it("throws for empty columns array", () => {
    expect(() => buildBatchColumnCommentDDL("cat.sch.tbl", [])).toThrow("No columns to update");
  });
});

// ---------------------------------------------------------------------------
// checkPermissions
// ---------------------------------------------------------------------------

describe("checkPermissions", () => {
  it("detects MODIFY permission from grants output", async () => {
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [
        { name: "principal", typeName: "STRING", position: 0 },
        { name: "action_type", typeName: "STRING", position: 1 },
      ],
      rows: [["user@example.com", "MODIFY"]],
      totalRowCount: 1,
    });

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(true);
  });

  it("detects ALL_PRIVILEGES as modify-capable", async () => {
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      rows: [["user@example.com", "ALL_PRIVILEGES"]],
      totalRowCount: 1,
    });

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(true);
  });

  it("detects OWN as modify-capable", async () => {
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      rows: [["user@example.com", "OWN"]],
      totalRowCount: 1,
    });

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(true);
  });

  it("returns canModify=false when only SELECT granted", async () => {
    mockExecuteSQL.mockResolvedValueOnce({
      columns: [],
      rows: [["user@example.com", "SELECT"]],
      totalRowCount: 1,
    });

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(false);
  });

  it("returns canModify=false on INSUFFICIENT_PERMISSIONS error", async () => {
    mockExecuteSQL.mockRejectedValueOnce(new Error("INSUFFICIENT_PERMISSIONS: cannot show grants"));

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(false);
    expect(result["cat.sch.tbl"].error).toContain("INSUFFICIENT_PERMISSIONS");
  });

  it("returns canModify=false on 'does not exist' error", async () => {
    mockExecuteSQL.mockRejectedValueOnce(new Error("Table cat.sch.tbl does not exist"));

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(false);
  });

  it("returns canModify=true (optimistic) on unknown errors", async () => {
    mockExecuteSQL.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await checkPermissions(["cat.sch.tbl"]);
    expect(result["cat.sch.tbl"].canModify).toBe(true);
    expect(result["cat.sch.tbl"].error).toContain("Could not verify");
  });

  it("checks multiple tables independently", async () => {
    mockExecuteSQL
      .mockResolvedValueOnce({ columns: [], rows: [["u", "MODIFY"]], totalRowCount: 1 })
      .mockResolvedValueOnce({ columns: [], rows: [["u", "SELECT"]], totalRowCount: 1 });

    const result = await checkPermissions(["cat.sch.t1", "cat.sch.t2"]);
    expect(result["cat.sch.t1"].canModify).toBe(true);
    expect(result["cat.sch.t2"].canModify).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyProposals
// ---------------------------------------------------------------------------

describe("applyProposals", () => {
  function makeProposal(overrides: Partial<CommentProposal> = {}): CommentProposal {
    return {
      id: "p1",
      jobId: "j1",
      tableFqn: "cat.sch.tbl",
      columnName: null,
      originalComment: null,
      proposedComment: "New description",
      editedComment: null,
      status: "accepted",
      errorMessage: null,
      appliedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("executes DDL and marks proposals applied", async () => {
    mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });

    const result = await applyProposals("j1", [makeProposal()]);

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockExecuteSQL).toHaveBeenCalledWith(
      "COMMENT ON TABLE `cat`.`sch`.`tbl` IS 'New description'",
    );
    expect(mockMarkApplied).toHaveBeenCalledWith(["p1"]);
  });

  it("uses editedComment over proposedComment when available", async () => {
    mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });

    await applyProposals("j1", [makeProposal({ editedComment: "Edited desc" })]);

    expect(mockExecuteSQL).toHaveBeenCalledWith(
      "COMMENT ON TABLE `cat`.`sch`.`tbl` IS 'Edited desc'",
    );
  });

  it("tracks per-proposal failures", async () => {
    mockExecuteSQL.mockRejectedValue(new Error("Permission denied"));

    const result = await applyProposals("j1", [makeProposal()]);

    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("Permission denied");
    expect(mockMarkFailed).toHaveBeenCalled();
  });

  it("skips column proposals for unsupported table types", async () => {
    const types = new Map([["cat.sch.tbl", "CSV"]]);

    const result = await applyProposals("j1", [makeProposal({ columnName: "col1" })], types);

    expect(result.skipped).toBe(1);
    expect(mockExecuteSQL).not.toHaveBeenCalled();
  });

  it("handles mixed success and failure across tables", async () => {
    mockExecuteSQL
      .mockResolvedValueOnce({ columns: [], rows: [], totalRowCount: 0 })
      .mockRejectedValueOnce(new Error("Failed"));

    const result = await applyProposals("j1", [
      makeProposal({ id: "p1", tableFqn: "cat.sch.tbl1" }),
      makeProposal({ id: "p2", tableFqn: "cat.sch.tbl2" }),
    ]);

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// undoProposals
// ---------------------------------------------------------------------------

describe("undoProposals", () => {
  function makeApplied(overrides: Partial<CommentProposal> = {}): CommentProposal {
    return {
      id: "p1",
      jobId: "j1",
      tableFqn: "cat.sch.tbl",
      columnName: null,
      originalComment: "Old description",
      proposedComment: "New description",
      editedComment: null,
      status: "applied",
      errorMessage: null,
      appliedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("restores original comment via DDL", async () => {
    mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });

    const result = await undoProposals("j1", [makeApplied()]);

    expect(result.applied).toBe(1);
    expect(mockExecuteSQL).toHaveBeenCalledWith(
      "COMMENT ON TABLE `cat`.`sch`.`tbl` IS 'Old description'",
    );
  });

  it("restores NULL when original comment was null", async () => {
    mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });

    await undoProposals("j1", [makeApplied({ originalComment: null })]);

    expect(mockExecuteSQL).toHaveBeenCalledWith("COMMENT ON TABLE `cat`.`sch`.`tbl` IS NULL");
  });

  it("restores empty string when original was empty", async () => {
    mockExecuteSQL.mockResolvedValue({ columns: [], rows: [], totalRowCount: 0 });

    await undoProposals("j1", [makeApplied({ originalComment: "" })]);

    expect(mockExecuteSQL).toHaveBeenCalledWith("COMMENT ON TABLE `cat`.`sch`.`tbl` IS ''");
  });
});
