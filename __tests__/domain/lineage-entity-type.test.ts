import { describe, expect, it } from "vitest";
import {
  LINEAGE_NULL_ENTITY_TYPE,
  fromStoredLineageEntityType,
  toStoredLineageEntityType,
} from "@/lib/domain/lineage-entity-type";

describe("lineage entity-type persistence boundary", () => {
  it("normalizes logical null and empty values to one durable database sentinel", () => {
    expect(toStoredLineageEntityType(null)).toBe(LINEAGE_NULL_ENTITY_TYPE);
    expect(toStoredLineageEntityType(undefined)).toBe(LINEAGE_NULL_ENTITY_TYPE);
    expect(toStoredLineageEntityType("")).toBe(LINEAGE_NULL_ENTITY_TYPE);
    expect(toStoredLineageEntityType("   ")).toBe(LINEAGE_NULL_ENTITY_TYPE);
  });

  it("preserves real entity types", () => {
    expect(toStoredLineageEntityType("JOB")).toBe("JOB");
    expect(toStoredLineageEntityType(" PIPELINE ")).toBe("PIPELINE");
  });

  it("restores the domain/API null semantic and never leaks sentinel or empty values", () => {
    expect(fromStoredLineageEntityType(LINEAGE_NULL_ENTITY_TYPE)).toBeNull();
    expect(fromStoredLineageEntityType("")).toBeNull();
    expect(fromStoredLineageEntityType("  ")).toBeNull();
    expect(fromStoredLineageEntityType(null)).toBeNull();
    expect(fromStoredLineageEntityType("NOTEBOOK")).toBe("NOTEBOOK");
  });
});
