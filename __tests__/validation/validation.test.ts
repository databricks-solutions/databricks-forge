import { describe, it, expect } from "vitest";
import {
  validateIdentifier,
  IdentifierValidationError,
  isValidUUID,
  validateUUID,
  CreateRunSchema,
} from "@/lib/validation";

describe("validateIdentifier", () => {
  it("accepts valid catalog names", () => {
    expect(validateIdentifier("my_catalog", "catalog")).toBe("my_catalog");
    expect(validateIdentifier("Catalog123", "catalog")).toBe("Catalog123");
    expect(validateIdentifier("my-catalog", "catalog")).toBe("my-catalog");
  });

  it("trims whitespace", () => {
    expect(validateIdentifier("  my_catalog  ", "catalog")).toBe("my_catalog");
  });

  it("rejects empty strings", () => {
    expect(() => validateIdentifier("", "catalog")).toThrow(IdentifierValidationError);
    expect(() => validateIdentifier("   ", "catalog")).toThrow(IdentifierValidationError);
  });

  it("rejects SQL injection characters", () => {
    expect(() => validateIdentifier("catalog; DROP TABLE", "catalog")).toThrow(
      IdentifierValidationError,
    );
    expect(() => validateIdentifier("catalog'--", "catalog")).toThrow(IdentifierValidationError);
    expect(() => validateIdentifier("cat`alog", "catalog")).toThrow(IdentifierValidationError);
    expect(() => validateIdentifier("catalog.schema", "catalog")).toThrow(
      IdentifierValidationError,
    );
  });

  it("rejects strings exceeding max length", () => {
    const longName = "a".repeat(256);
    expect(() => validateIdentifier(longName, "catalog")).toThrow(IdentifierValidationError);
  });
});

describe("isValidUUID", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("")).toBe(false);
    expect(isValidUUID("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isValidUUID("550e8400e29b41d4a716446655440000")).toBe(false);
  });
});

describe("validateUUID", () => {
  it("returns valid UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(validateUUID(uuid)).toBe(uuid);
  });

  it("throws on invalid UUID", () => {
    expect(() => validateUUID("bad")).toThrow("not a valid UUID");
  });
});

describe("CreateRunSchema", () => {
  it("validates a minimal valid body", () => {
    const result = CreateRunSchema.safeParse({
      businessName: "Acme Corp",
      ucMetadata: "catalog.schema",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing businessName", () => {
    const result = CreateRunSchema.safeParse({
      ucMetadata: "catalog.schema",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing ucMetadata", () => {
    const result = CreateRunSchema.safeParse({
      businessName: "Acme Corp",
    });
    expect(result.success).toBe(false);
  });

  it("clamps sampleRowsPerTable to 0-50 range", () => {
    const result = CreateRunSchema.parse({
      businessName: "Acme",
      ucMetadata: "cat.schema",
      sampleRowsPerTable: 100,
    });
    expect(result.sampleRowsPerTable).toBe(50);

    const result2 = CreateRunSchema.parse({
      businessName: "Acme",
      ucMetadata: "cat.schema",
      sampleRowsPerTable: -5,
    });
    expect(result2.sampleRowsPerTable).toBe(0);
  });

  it("applies defaults for optional fields", () => {
    const result = CreateRunSchema.parse({
      businessName: "Acme",
      ucMetadata: "cat.schema",
    });
    expect(result.aiModel).toBe("databricks-claude-opus-4-7");
    expect(result.operation).toBe("Discover Usecases");
    expect(result.languages).toEqual(["English"]);
  });
});
