/**
 * Tests for the Data Gap lazy backfill of `referenceUseCaseName`.
 *
 * The backfill runs the first time the Data Gap route's `compute()` sees
 * a use case without a persisted master-repo link. It calls a single
 * lightweight LLM to map every customer UC name onto the closest
 * master-repo title, validates each emitted name against the allow-list,
 * and persists the result so subsequent computes are deterministic.
 *
 * Covered:
 *   - Short-circuits when every UC already has a link.
 *   - LLM happy path: returns canonical-cased names, persists exactly once.
 *   - LLM hallucination defence: unknown titles coerced to null.
 *   - LLM call failure: returns the input unchanged, never throws.
 *   - JSON parse failure: returns the input unchanged.
 *   - Persistence failure: returns the input unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dbx/client", () => ({
  resolveEndpoint: vi.fn(() => "fake-endpoint"),
}));

vi.mock("@/lib/dbx/model-serving", async (orig) => {
  const actual = await orig<typeof import("@/lib/dbx/model-serving")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

vi.mock("@/lib/lakebase/usecases", () => ({
  updateUseCaseReferenceLinks: vi.fn().mockResolvedValue(undefined),
}));

import {
  backfillReferenceUseCaseNames,
  mapUseCasesToMasterRepo,
} from "@/lib/engines/data-gap-analysis/reference-backfill";
import { chatCompletion } from "@/lib/dbx/model-serving";
import { updateUseCaseReferenceLinks } from "@/lib/lakebase/usecases";
import type { UseCase } from "@/lib/domain/types";
import type { MasterRepoEnrichment } from "@/lib/domain/industry-outcomes/master-repo-types";

const mockedChat = chatCompletion as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = updateUseCaseReferenceLinks as unknown as ReturnType<typeof vi.fn>;

const ENRICHMENT: MasterRepoEnrichment = {
  useCases: [
    {
      name: "Customer Lifetime Value Modeling",
      description: "Predict per-customer future value.",
      dataAssetIds: ["A01"],
      dataAssetCriticality: { A01: "MC" },
    },
    {
      name: "Real-Time Fraud Detection",
      description: "Detect anomalous transactions in real time.",
      dataAssetIds: ["A02"],
      dataAssetCriticality: { A02: "MC" },
    },
  ],
  dataAssets: [
    {
      id: "A01",
      name: "Customer",
      description: "",
      systemLocation: "CRM",
      assetFamily: "Customer",
      easeOfAccess: "Medium",
      lakeflowConnect: "High",
      ucFederation: "Low",
      lakebridgeMigrate: "Low",
    },
    {
      id: "A02",
      name: "Transactions",
      description: "",
      systemLocation: "Payments",
      assetFamily: "Transactions",
      easeOfAccess: "Medium",
      lakeflowConnect: "High",
      ucFederation: "Low",
      lakebridgeMigrate: "Low",
    },
  ],
};

function makeUseCase(overrides: Partial<UseCase> & { id: string; name: string }): UseCase {
  return {
    id: overrides.id,
    runId: "run-1",
    useCaseNo: 1,
    name: overrides.name,
    type: "AI",
    analyticsTechnique: "",
    statement: overrides.statement ?? "",
    solution: "",
    businessValue: overrides.businessValue ?? "",
    beneficiary: "",
    sponsor: "",
    domain: "",
    subdomain: "",
    tablesInvolved: [],
    priorityScore: 0,
    feasibilityScore: 0,
    impactScore: 0,
    overallScore: 0,
    userPriorityScore: null,
    userFeasibilityScore: null,
    userImpactScore: null,
    userOverallScore: null,
    scoreRationale: null,
    consultingScorecard: null,
    sqlCode: null,
    sqlStatus: null,
    feedback: null,
    feedbackAt: null,
    enrichmentTags: null,
    sourceSystems: null,
    sourceSystemsOrigin: null,
    blastRadius: null,
    referenceUseCaseName: overrides.referenceUseCaseName ?? null,
    referenceUseCaseResolvedAt: overrides.referenceUseCaseResolvedAt ?? null,
  };
}

function chatResponse(content: string) {
  return {
    content,
    usage: null,
    model: "fake",
    finishReason: "stop" as const,
  };
}

beforeEach(() => {
  mockedChat.mockReset();
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------
// backfillReferenceUseCaseNames
// ---------------------------------------------------------------------

describe("backfillReferenceUseCaseNames", () => {
  it("short-circuits when every UC already has a referenceUseCaseName", async () => {
    const useCases = [
      makeUseCase({
        id: "uc-1",
        name: "Already Linked",
        referenceUseCaseName: "Customer Lifetime Value Modeling",
      }),
    ];
    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });
    expect(out).toBe(useCases);
    expect(mockedChat).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("calls the LLM exactly once and persists the validated links", async () => {
    mockedChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          links: [
            {
              use_case_id: "uc-1",
              reference_use_case_name: "customer lifetime value modeling", // lowercase -> normalised
            },
            {
              use_case_id: "uc-2",
              reference_use_case_name: "Real-Time Fraud Detection",
            },
          ],
        }),
      ),
    );

    const useCases = [
      makeUseCase({ id: "uc-1", name: "Predict Loyalty Value" }),
      makeUseCase({ id: "uc-2", name: "Spot Bad Transactions" }),
    ];

    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });

    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith([
      { useCaseId: "uc-1", referenceUseCaseName: "Customer Lifetime Value Modeling" },
      { useCaseId: "uc-2", referenceUseCaseName: "Real-Time Fraud Detection" },
    ]);

    const byId = new Map(out.map((u) => [u.id, u]));
    expect(byId.get("uc-1")!.referenceUseCaseName).toBe("Customer Lifetime Value Modeling");
    expect(byId.get("uc-2")!.referenceUseCaseName).toBe("Real-Time Fraud Detection");
    // Every updated row carries a fresh resolution timestamp.
    expect(byId.get("uc-1")!.referenceUseCaseResolvedAt).toBeTruthy();
    expect(byId.get("uc-2")!.referenceUseCaseResolvedAt).toBeTruthy();
  });

  it("coerces hallucinated reference titles to null", async () => {
    mockedChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          links: [
            {
              use_case_id: "uc-1",
              reference_use_case_name: "This Reference Does Not Exist",
            },
          ],
        }),
      ),
    );

    const useCases = [makeUseCase({ id: "uc-1", name: "Bespoke UC" })];
    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith([
      { useCaseId: "uc-1", referenceUseCaseName: null },
    ]);
    expect(out[0]!.referenceUseCaseName).toBeNull();
    // We still bump the resolved-at so the staleness check knows the run
    // has been processed.
    expect(out[0]!.referenceUseCaseResolvedAt).toBeTruthy();
  });

  it("filters out items whose useCaseId is unknown to this run", async () => {
    // Defensive: an LLM that hallucinates an unrelated id should not be
    // allowed to write garbage into the DB.
    mockedChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          links: [
            {
              use_case_id: "uc-1",
              reference_use_case_name: "Real-Time Fraud Detection",
            },
            {
              use_case_id: "uc-not-in-this-run",
              reference_use_case_name: "Customer Lifetime Value Modeling",
            },
          ],
        }),
      ),
    );

    const useCases = [makeUseCase({ id: "uc-1", name: "Bespoke UC" })];
    await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });

    expect(mockedUpdate).toHaveBeenCalledWith([
      { useCaseId: "uc-1", referenceUseCaseName: "Real-Time Fraud Detection" },
    ]);
  });

  it("returns the input unchanged when the LLM throws", async () => {
    mockedChat.mockRejectedValue(new Error("model 500"));
    const useCases = [makeUseCase({ id: "uc-1", name: "X" })];
    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });
    expect(out).toBe(useCases);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns the input unchanged when the LLM emits unparseable JSON", async () => {
    mockedChat.mockResolvedValue(chatResponse("definitely not json"));
    const useCases = [makeUseCase({ id: "uc-1", name: "X" })];
    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });
    expect(out).toBe(useCases);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns the input unchanged when persistence throws", async () => {
    mockedChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          links: [
            {
              use_case_id: "uc-1",
              reference_use_case_name: "Real-Time Fraud Detection",
            },
          ],
        }),
      ),
    );
    mockedUpdate.mockRejectedValueOnce(new Error("db down"));

    const useCases = [makeUseCase({ id: "uc-1", name: "X" })];
    const out = await backfillReferenceUseCaseNames({
      runId: "run-1",
      useCases,
      enrichment: ENRICHMENT,
    });
    // Persistence failed -> we surface the input unchanged so the engine
    // falls through to the existing fuzzy matcher rather than silently
    // claiming the row was updated.
    expect(out).toBe(useCases);
  });
});

// ---------------------------------------------------------------------
// mapUseCasesToMasterRepo (unit-level)
// ---------------------------------------------------------------------

describe("mapUseCasesToMasterRepo", () => {
  it("returns [] for empty input without calling the LLM", async () => {
    const out = await mapUseCasesToMasterRepo([], ENRICHMENT);
    expect(out).toEqual([]);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("returns [] for empty enrichment without calling the LLM", async () => {
    const out = await mapUseCasesToMasterRepo(
      [{ id: "uc-1", name: "X", statement: "", businessValue: "" }],
      { useCases: [], dataAssets: [] },
    );
    expect(out).toEqual([]);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("accepts camelCase variants of the LLM keys", async () => {
    // We don't dictate the LLM's exact key casing; accept either snake_case
    // or camelCase to be resilient to model quirks.
    mockedChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          links: [
            { useCaseId: "uc-1", referenceUseCaseName: "Real-Time Fraud Detection" },
          ],
        }),
      ),
    );
    const out = await mapUseCasesToMasterRepo(
      [{ id: "uc-1", name: "X", statement: "", businessValue: "" }],
      ENRICHMENT,
    );
    expect(out).toEqual([
      { useCaseId: "uc-1", referenceUseCaseName: "Real-Time Fraud Detection" },
    ]);
  });
});
