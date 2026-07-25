import { describe, expect, it, vi, beforeEach } from "vitest";
import { assessReadiness } from "@/lib/genie/readiness";

vi.mock("@/lib/dbx/client", () => ({
  resolveEndpoint: vi.fn().mockReturnValue("test-endpoint"),
}));

vi.mock("@/lib/dbx/model-serving", () => ({
  chatCompletion: vi.fn(),
}));

vi.mock("@/lib/toolkit/parse-llm-json", () => ({
  parseLLMJson: vi.fn((s: string) => JSON.parse(s)),
}));

import { chatCompletion } from "@/lib/dbx/model-serving";

describe("assessReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_answerable for empty inputs", async () => {
    const r = await assessReadiness({
      catalog: "main",
      schema: "sales",
      tables: [],
      questions: [{ question: "What's revenue?" }],
    });
    expect(r.ready).toBe(false);
    expect(r.summary.notAnswerable).toBe(1);
    expect(r.results[0].verdict).toBe("not_answerable");
  });

  it("classifies LLM verdicts and surfaces requiredTables", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify([
        {
          verdict: "answerable",
          rationale: "orders table has revenue and region columns.",
          requiredTables: ["main.sales.orders"],
        },
        {
          verdict: "partial",
          rationale: "no churn metric column; needs derived calc.",
          requiredTables: ["main.sales.customers"],
        },
        { verdict: "not_answerable", rationale: "no inventory tables." },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const r = await assessReadiness({
      catalog: "main",
      schema: "sales",
      tables: [
        { fqn: "main.sales.orders", columnNames: ["amount", "region"] },
        { fqn: "main.sales.customers", columnNames: ["id", "name"] },
      ],
      questions: [
        { question: "What is revenue by region?" },
        { question: "What is churn?" },
        { question: "What is inventory level?" },
      ],
    });

    expect(r.results.map((x) => x.verdict)).toEqual([
      "answerable",
      "partial",
      "not_answerable",
    ]);
    expect(r.summary).toEqual({ answerable: 1, partial: 1, notAnswerable: 1 });
    expect(r.ready).toBe(false);
    expect(r.results[0].requiredTables).toEqual(["main.sales.orders"]);
  });

  it("falls back to partial on LLM failure", async () => {
    vi.mocked(chatCompletion).mockRejectedValueOnce(new Error("network error"));
    const r = await assessReadiness({
      catalog: "main",
      schema: "sales",
      tables: [{ fqn: "main.sales.orders", columnNames: ["amount"] }],
      questions: [{ question: "What is revenue?" }],
    });
    expect(r.results[0].verdict).toBe("partial");
    expect(r.results[0].rationale.toLowerCase()).toContain("readiness");
  });

  it("falls back to partial when LLM JSON is malformed", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: "not-json garbage",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await assessReadiness({
      catalog: "main",
      schema: "sales",
      tables: [{ fqn: "main.sales.orders" }],
      questions: [{ question: "What is revenue?" }],
    });
    expect(r.results[0].verdict).toBe("partial");
  });

  it("accepts a wrapped { results: [...] } envelope", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify({
        results: [{ verdict: "answerable", rationale: "ok" }],
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await assessReadiness({
      catalog: "main",
      tables: [{ fqn: "main.sales.orders" }],
      questions: [{ question: "What is revenue?" }],
    });
    expect(r.results[0].verdict).toBe("answerable");
  });

  it("ready=true when every question is at least partial", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify([
        { verdict: "answerable", rationale: "" },
        { verdict: "partial", rationale: "" },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await assessReadiness({
      catalog: "main",
      tables: [{ fqn: "main.sales.orders" }],
      questions: [{ question: "Q1" }, { question: "Q2" }],
    });
    expect(r.ready).toBe(true);
  });
});
