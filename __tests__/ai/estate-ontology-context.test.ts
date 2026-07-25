import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedLogger } from "@/lib/logger";
import type { TableDetail } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
  formatPrompt: vi.fn((_key: string, vars: Record<string, string>) => JSON.stringify(vars)),
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      entities: [
        {
          name: "Well",
          domain: "Upstream",
          description: "A producing well.",
          tables: ["energy.upstream.wells"],
        },
      ],
      glossary: [],
    }),
    model: "test",
    finishReason: "stop",
  })),
}));

vi.mock("@/lib/ai/templates", () => ({ formatPrompt: mocks.formatPrompt }));
vi.mock("@/lib/dbx/model-serving", () => ({ chatCompletion: mocks.chatCompletion }));

import { runEstateOntology } from "@/lib/ai/estate-ontology";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  timed: vi.fn(),
  context: {},
} as unknown as ScopedLogger;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("estate ontology context grounding", () => {
  it("includes industry, sub-vertical, and organisation context in the ontology prompt", async () => {
    const detail = {
      fqn: "energy.upstream.wells",
      dataDomain: "Upstream",
      dataTier: "gold",
    } as TableDetail;

    await runEstateOntology(
      {
        details: [detail],
        domains: [{ domain: "Upstream", subdomain: "Wells", tables: [detail.fqn], description: "" }],
        dataProducts: [],
        implicitRelationships: [],
        foreignKeys: [],
        lineageGraph: {
          edges: [],
          seedTables: [detail.fqn],
          discoveredTables: [],
          upstreamDepth: 0,
          downstreamDepth: 0,
        },
      },
      {
        endpoint: "test",
        log,
        industryId: "oil-gas-noc",
        subVertical: "National Oil Company",
        orgContext: "State-owned integrated energy operator",
      },
    );

    expect(mocks.formatPrompt).toHaveBeenCalledWith(
      "ENV_CANONICAL_ENTITIES_PROMPT",
      expect.objectContaining({
        estate_context: expect.stringContaining("Industry: oil-gas-noc"),
      }),
    );
    const vars = mocks.formatPrompt.mock.calls[0][1];
    expect(vars.estate_context).toContain("Sub-vertical: National Oil Company");
    expect(vars.estate_context).toContain(
      "Organisation context: State-owned integrated energy operator",
    );
  });
});
