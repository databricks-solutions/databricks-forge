import { describe, expect, it } from "vitest";

import { sanitizeBoundedDiagnostic } from "@/lib/logging/bounded-diagnostic";

describe("sanitizeBoundedDiagnostic", () => {
  it("redacts authorization and query credentials in one bounded diagnostic", () => {
    const sanitized = sanitizeBoundedDiagnostic(
      "Retry failed; Authorization: CustomScheme auth-secret; /path?access_token=query-secret&safe=value",
      120,
    );

    expect(sanitized).toContain("Retry failed");
    expect(sanitized).toContain("safe=value");
    expect(sanitized?.length).toBeLessThanOrEqual(120);
    expect(sanitized).not.toContain("CustomScheme");
    expect(sanitized).not.toContain("auth-secret");
    expect(sanitized).not.toContain("query-secret");
  });

  it("preserves ordinary prose that names security concepts", () => {
    const message = "Password policy and API key rotation guidance are unavailable";
    expect(sanitizeBoundedDiagnostic(message)).toBe(message);
  });

  it.each([
    "failed to update dashboard",
    "create request rejected",
    "drop connection",
    "select an option",
    "select dashboard to continue",
  ])("preserves non-SQL prose: %s", (message) => {
    expect(sanitizeBoundedDiagnostic(message)).toBe(message);
  });

  it.each([
    "SELECT customer_id FROM main.sales.orders WHERE region = 'private'",
    "UPDATE main.sales.orders SET owner = 'private' WHERE id = 1",
    "INSERT INTO main.sales.orders (owner) VALUES ('private')",
    "DELETE FROM main.sales.orders WHERE owner = 'private'",
    "CREATE OR REPLACE VIEW main.sales.private_view AS SELECT 1",
    "ALTER TABLE main.sales.orders SET TBLPROPERTIES ('owner' = 'private')",
    "DROP TABLE main.sales.private_table",
  ])("redacts structurally recognized SQL while preserving surrounding diagnostics", (sql) => {
    const sanitized = sanitizeBoundedDiagnostic(
      `Warehouse operation failed; ${sql}; retry remains available`,
    );

    expect(sanitized).toContain("Warehouse operation failed");
    expect(sanitized).toContain("[redacted SQL]");
    expect(sanitized).toContain("retry remains available");
    expect(sanitized).not.toContain("main.sales");
    expect(sanitized).not.toContain("private");
  });

  it.each([
    "SELECT 'private-literal'",
    "SELECT 987654321",
    "SELECT *",
    "SELECT current_user()",
    "SELECT secret_one, secret_two",
    "SELECT private_value AS leaked_alias",
    "SELECT 40 + 2",
  ])("redacts SELECT without FROM when projection evidence is structural: %s", (sql) => {
    const sanitized = sanitizeBoundedDiagnostic(`Query failed; ${sql}; retry is safe`);

    expect(sanitized).toBe("Query failed; [redacted SQL]; retry is safe");
  });

  it.each([
    "UPDATE users SET password = 'private-password'",
    "UPDATE `orders` SET owner = 'private-owner'",
    "UPDATE main.sales.orders SET owner = 'private-owner'",
  ])("redacts UPDATE with valid identifier and SET: %s", (sql) => {
    const sanitized = sanitizeBoundedDiagnostic(`Mutation failed; ${sql}; retry is safe`);

    expect(sanitized).toBe("Mutation failed; [redacted SQL]; retry is safe");
  });
});
