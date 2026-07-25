import { describe, it, expect } from "vitest";
import {
  TABLE_COMMENT_PROMPT,
  COLUMN_COMMENT_PROMPT,
  CONSISTENCY_REVIEW_PROMPT,
} from "@/lib/ai/comment-engine/prompts";

describe("TABLE_COMMENT_PROMPT", () => {
  it("contains all required placeholders", () => {
    expect(TABLE_COMMENT_PROMPT).toContain("{language_directive}");
    expect(TABLE_COMMENT_PROMPT).toContain("{industry_context}");
    expect(TABLE_COMMENT_PROMPT).toContain("{business_context_block}");
    expect(TABLE_COMMENT_PROMPT).toContain("{data_asset_context}");
    expect(TABLE_COMMENT_PROMPT).toContain("{use_case_linkage}");
    expect(TABLE_COMMENT_PROMPT).toContain("{schema_summary}");
    expect(TABLE_COMMENT_PROMPT).toContain("{lineage_context}");
    expect(TABLE_COMMENT_PROMPT).toContain("{table_list}");
  });

  it("specifies JSON output format", () => {
    expect(TABLE_COMMENT_PROMPT).toContain("JSON array");
    expect(TABLE_COMMENT_PROMPT).toContain("table_fqn");
    expect(TABLE_COMMENT_PROMPT).toContain("description");
  });

  it("includes length guidance", () => {
    expect(TABLE_COMMENT_PROMPT).toMatch(/100.*200|characters/i);
  });

  it("instructs not to repeat table name", () => {
    expect(TABLE_COMMENT_PROMPT).toMatch(/not.*repeat.*table name/i);
  });

  it("mentions Genie Space discoverability", () => {
    expect(TABLE_COMMENT_PROMPT).toContain("Genie Space");
  });

  it("instructs to include business terms and synonyms", () => {
    expect(TABLE_COMMENT_PROMPT).toMatch(/business.*terms|synonyms/i);
    expect(TABLE_COMMENT_PROMPT).toContain("COMMON SYNONYMS");
  });

  it("instructs about write frequency context", () => {
    expect(TABLE_COMMENT_PROMPT).toContain("write-frequency");
  });

  it("all placeholders are replaceable without residual placeholder patterns", () => {
    const replaced = TABLE_COMMENT_PROMPT.replace("{language_directive}", "Write in English.")
      .replace("{industry_context}", "Banking industry")
      .replace("{business_context_block}", "Retail banking focus")
      .replace("{data_asset_context}", "A01: Customer Master")
      .replace("{use_case_linkage}", "A01 powers personalization")
      .replace("{schema_summary}", "2 tables in schema")
      .replace("{lineage_context}", "orders -> summary")
      .replace("{table_list}", "- cat.sch.tbl: [col1 (STRING)]");

    expect(replaced).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe("COLUMN_COMMENT_PROMPT", () => {
  it("contains all required placeholders", () => {
    expect(COLUMN_COMMENT_PROMPT).toContain("{language_directive}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{industry_context}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{table_fqn}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{table_description}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{table_domain}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{table_role}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{data_asset_block}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{related_tables}");
    expect(COLUMN_COMMENT_PROMPT).toContain("{column_list}");
  });

  it("specifies JSON output format", () => {
    expect(COLUMN_COMMENT_PROMPT).toContain("JSON array");
    expect(COLUMN_COMMENT_PROMPT).toContain("column_name");
    expect(COLUMN_COMMENT_PROMPT).toContain("description");
  });

  it("includes length guidance for columns", () => {
    expect(COLUMN_COMMENT_PROMPT).toMatch(/50.*150|characters/i);
  });

  it("mentions null return for good existing comments", () => {
    expect(COLUMN_COMMENT_PROMPT).toMatch(/null.*description|return null/i);
  });

  it("instructs to include business terms", () => {
    expect(COLUMN_COMMENT_PROMPT).toContain("BUSINESS TERMS");
  });

  it("instructs about FK column descriptions", () => {
    expect(COLUMN_COMMENT_PROMPT).toContain("FK");
    expect(COLUMN_COMMENT_PROMPT).toContain("join");
  });

  it("instructs about terminology consistency", () => {
    expect(COLUMN_COMMENT_PROMPT).toContain("CONSISTENT");
  });

  it("all placeholders are replaceable without residual placeholder patterns", () => {
    const replaced = COLUMN_COMMENT_PROMPT.replace("{language_directive}", "Write in English.")
      .replace("{industry_context}", "Banking")
      .replace("{table_fqn}", "cat.sch.tbl")
      .replace("{table_description}", "Customer transactions")
      .replace("{table_domain}", "Transaction")
      .replace("{table_role}", "fact")
      .replace("{data_asset_block}", "A06: Transaction Ledger")
      .replace("{related_tables}", "- cat.sch.customers: Customer dim")
      .replace("{column_list}", "- customer_id: STRING\n- amount: DOUBLE");

    expect(replaced).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe("CONSISTENCY_REVIEW_PROMPT", () => {
  it("contains all required placeholders", () => {
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("{language_directive}");
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("{schema_summary}");
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("{descriptions_list}");
  });

  it("specifies JSON output format", () => {
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("JSON array");
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("table_fqn");
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("issue");
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("fixed");
  });

  it("checks for terminology consistency", () => {
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("Terminology consistency");
    expect(CONSISTENCY_REVIEW_PROMPT).toMatch(/customer.*client|same.*word/i);
  });

  it("checks for Genie-readiness", () => {
    expect(CONSISTENCY_REVIEW_PROMPT).toContain("Genie-readiness");
  });

  it("all placeholders are replaceable", () => {
    const replaced = CONSISTENCY_REVIEW_PROMPT.replace(
      "{language_directive}",
      "Write in English.",
    )
      .replace("{schema_summary}", "2 tables")
      .replace("{descriptions_list}", "- TABLE: cat.sch.tbl: desc");

    expect(replaced).not.toMatch(/\{[a-z_]+\}/);
  });
});
