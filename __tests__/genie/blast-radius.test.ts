import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { evaluateBlastRadius, gateByBlastRadius } from "@/lib/genie/blast-radius";

const before = {
  data_sources: {
    tables: [
      { path: "c.s.t1", description: "T1" },
      { path: "c.s.t2", description: "T2" },
    ],
  },
};

beforeEach(() => {
  delete process.env.FORGE_BLAST_RADIUS_MAX;
});

afterEach(() => {
  delete process.env.FORGE_BLAST_RADIUS_MAX;
});

describe("evaluateBlastRadius", () => {
  it("reports no changes when before === after", () => {
    const r = evaluateBlastRadius({ before, after: before });
    expect(r.noChanges).toBe(true);
    expect(r.exceeded).toBe(false);
  });

  it("counts a single touched table", () => {
    const after = {
      data_sources: {
        tables: [
          { path: "c.s.t1", description: "T1" },
          { path: "c.s.t2", description: "T2 updated" },
        ],
      },
    };
    const r = evaluateBlastRadius({ before, after });
    expect(r.tablesTouched).toContain("c.s.t2");
    expect(r.exceeded).toBe(false);
  });

  it("flags exceeded when more than max tables touched", () => {
    process.env.FORGE_BLAST_RADIUS_MAX = "1";
    const after = {
      data_sources: {
        tables: [
          { path: "c.s.t1", description: "T1 changed" },
          { path: "c.s.t2", description: "T2 changed" },
        ],
      },
    };
    const r = evaluateBlastRadius({ before, after });
    expect(r.exceeded).toBe(true);
    expect(r.max).toBe(1);
  });

  it("respects an explicit max override", () => {
    const after = {
      data_sources: {
        tables: [
          { path: "c.s.t1", description: "X" },
          { path: "c.s.t2", description: "Y" },
        ],
      },
    };
    const r = evaluateBlastRadius({ before, after, max: 1 });
    expect(r.exceeded).toBe(true);
    expect(r.max).toBe(1);
  });
});

describe("gateByBlastRadius", () => {
  it("allows when within budget", () => {
    const after = {
      data_sources: {
        tables: [{ path: "c.s.t1", description: "x" }, { path: "c.s.t2", description: "y" }],
      },
    };
    const out = gateByBlastRadius({ before, after, payload: { fix: true } });
    expect(out.allowed).toBe(true);
    expect(out.payload).toEqual({ fix: true });
  });

  it("drops when over budget", () => {
    process.env.FORGE_BLAST_RADIUS_MAX = "1";
    const after = {
      data_sources: {
        tables: [
          { path: "c.s.t1", description: "z1" },
          { path: "c.s.t2", description: "z2" },
        ],
      },
    };
    const out = gateByBlastRadius({ before, after, payload: { fix: true } });
    expect(out.allowed).toBe(false);
    expect(out.payload).toBeNull();
  });
});
