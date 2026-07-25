import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  scanId: string | null;
  estateId: string | null;
  ownerEmail: string | null;
  industryId: string | null;
  briefJson: string;
  findingsJson: string;
  evidenceJson: string | null;
  valueAtRiskJson: string | null;
  scoresJson: string | null;
  passResultsJson: string | null;
  createdAt: Date;
}

let store: Row[] = [];

const create = vi.fn(async ({ data, select }: { data: Omit<Row, "id" | "createdAt">; select?: unknown }) => {
  const row: Row = { id: `row-${store.length + 1}`, createdAt: new Date("2026-06-01T00:00:00Z"), ...data };
  store.push(row);
  return select ? { id: row.id } : row;
});
const findFirst = vi.fn(async ({ where, orderBy: _o }: { where: Partial<Row>; orderBy?: unknown }) => {
  const matches = store.filter((r) =>
    Object.entries(where).every(
      ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
    ),
  );
  return matches.length ? matches[matches.length - 1] : null;
});

vi.mock("@/lib/prisma", () => ({
  withPrisma: async <T,>(cb: (prisma: unknown) => Promise<T>) =>
    cb({ forgeEstateSynthesis: { create, findFirst } }),
}));

import {
  saveEstateSynthesis,
  getLatestSynthesisForScan,
  getLatestSynthesisForEstate,
} from "@/lib/lakebase/estate-synthesis";
import { runEstateSynthesis } from "@/lib/ai/estate-synthesis/engine";
import type { EstateSynthesisInput } from "@/lib/ai/estate-synthesis/types";

function input(): EstateSynthesisInput {
  return {
    scanId: "scan-1",
    ucPath: "main.sales",
    industryId: "retail",
    industryName: "Retail",
    tables: [
      {
        fqn: "main.sales.customer",
        dataDomain: "Sales",
        dataTier: "gold",
        comment: "documented",
        generatedDescription: null,
        governanceScore: 80,
        sensitivityLevel: null,
        owner: "t@x.com",
        lastWriteAt: new Date().toISOString(),
        healthScore: 85,
      },
    ],
    insights: [],
    readinessScore: 60,
    analyticsMaturityScore: 50,
    dataGap: null,
    waf: null,
    costWasteUsd: null,
  };
}

describe("estate-synthesis engine -> Lakebase round trip", () => {
  beforeEach(() => {
    store = [];
    create.mockClear();
    findFirst.mockClear();
  });

  it("persists a generated synthesis and reads it back by scanId", async () => {
    const result = await runEstateSynthesis(input(), {
      callLLM: async () =>
        JSON.stringify({
          estateShape: "shape",
          strengths: "s",
          criticalRisks: "r",
          quickWins: "q",
          strategicRecommendations: "rec",
          situationComplicationResolution: { situation: "S", complication: "C", resolution: "R" },
        }),
    });

    const id = await saveEstateSynthesis({
      scanId: "scan-1",
      ownerEmail: "u@x.com",
      industryId: "retail",
      result,
    });
    expect(id).toBe("row-1");

    // The create call serialised each sub-object to its JSON column.
    const data = create.mock.calls[0][0].data;
    expect(JSON.parse(data.briefJson).estateShape).toBe("shape");
    expect(Array.isArray(JSON.parse(data.findingsJson))).toBe(true);
    expect(JSON.parse(data.scoresJson ?? "{}").overall).toBe(result.scores.overall);

    const readBack = await getLatestSynthesisForScan("scan-1");
    expect(readBack).not.toBeNull();
    expect(readBack!.scanId).toBe("scan-1");
    expect(readBack!.brief.estateShape).toBe("shape");
    expect(readBack!.scores.overall).toBe(result.scores.overall);
    expect(readBack!.industryId).toBe("retail");
  });

  it("returns null for a scan with no synthesis", async () => {
    expect(await getLatestSynthesisForScan("nope")).toBeNull();
  });

  it("supports estate roll-up persistence keyed by estateId", async () => {
    const result = await runEstateSynthesis(input(), {
      callLLM: async () => {
        throw new Error("fallback path");
      },
    });
    await saveEstateSynthesis({ estateId: "estate-9", result });
    const rollup = await getLatestSynthesisForEstate("estate-9");
    expect(rollup!.estateId).toBe("estate-9");
    expect(rollup!.scanId).toBeNull();
  });
});
