import { describe, it, expect } from "vitest";
import { profileCasing, casingNoteFor } from "@/lib/metadata/casing-profile";

describe("profileCasing", () => {
  it("identifies titlecase dominance", () => {
    const result = profileCasing([
      "Acme Corp",
      "Globex Inc",
      "Initech Co",
      "Pied Piper",
    ]);
    expect(result.titleCount).toBe(4);
    expect(result.dominant).toBe("title");
    expect(result.dominantCoverage).toBeGreaterThanOrEqual(0.7);
  });

  it("identifies uppercase dominance", () => {
    const result = profileCasing(["ACME", "GLOBEX", "INITECH", "VANDELAY"]);
    expect(result.upperCount).toBe(4);
    expect(result.dominant).toBe("upper");
  });

  it("identifies lowercase dominance", () => {
    const result = profileCasing(["acme", "globex", "initech"]);
    expect(result.lowerCount).toBe(3);
    expect(result.dominant).toBe("lower");
  });

  it("returns mixed when no style dominates", () => {
    const result = profileCasing(["Acme", "GLOBEX", "initech", "OdD"]);
    expect(result.dominant).toBe("mixed");
  });

  it("returns unknown for empty input", () => {
    const result = profileCasing([]);
    expect(result.dominant).toBe("unknown");
    expect(result.total).toBe(0);
  });

  it("ignores non-string and empty values", () => {
    const result = profileCasing(["", "  ", null, 42, "Acme Corp"]);
    expect(result.total).toBe(1);
    expect(result.titleCount).toBe(1);
  });

  it("respects a custom threshold", () => {
    const result = profileCasing(["Acme", "Globex", "INITECH", "VANDELAY"], 0.6);
    expect(result.dominant).toBe("mixed");
    const stricter = profileCasing(
      ["Acme", "Globex", "Initech", "Vandelay", "INITECH"],
      0.6,
    );
    expect(stricter.dominant).toBe("title");
  });
});

describe("casingNoteFor", () => {
  it("emits an instruction for a dominant style", () => {
    const note = casingNoteFor({
      tableFqn: "cat.sch.customers",
      columnName: "name",
      total: 10,
      titleCount: 9,
      upperCount: 0,
      lowerCount: 0,
      otherCount: 1,
      dominant: "title",
      dominantCoverage: 0.9,
    });
    expect(note).toContain("90% TitleCase");
    expect(note).toContain("LOWER()");
  });

  it("returns null for mixed/unknown", () => {
    expect(
      casingNoteFor({
        tableFqn: "cat.sch.t",
        columnName: "c",
        total: 0,
        titleCount: 0,
        upperCount: 0,
        lowerCount: 0,
        otherCount: 0,
        dominant: "unknown",
        dominantCoverage: 0,
      }),
    ).toBeNull();
  });
});
