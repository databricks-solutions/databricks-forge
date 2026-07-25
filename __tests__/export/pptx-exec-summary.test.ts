import { describe, expect, it } from "vitest";
import {
  buildExecutiveSummaryItems,
  paginateSummaryItems,
  splitLongFieldIntoBullets,
  type ExecutiveSummaryLine,
} from "@/lib/export/pptx-exec-summary";

describe("pptx executive summary helpers", () => {
  it("splits long comma-separated goals into grouped sub-bullets", () => {
    const lines = splitLongFieldIntoBullets({
      label: "Strategic Goals",
      value:
        "Increase Revenue through expansion, Improve Customer Experience with personalization, Enable Data-Driven Decisions, Protect Revenue with loyalty optimization, Boost Productivity by automating merchandising, Mitigate Risk in fraud and privacy controls",
    });

    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toMatchObject({
      kind: "bullet",
      text: "Strategic Goals:",
      keepWithNext: true,
    });
    expect(lines.slice(1).every((line) => line.kind === "sub-bullet")).toBe(true);
  });

  it("builds ordered summary lines with narrative first", () => {
    const lines = buildExecutiveSummaryItems({
      executiveSummary: "Top opportunities are in Marketing and Fraud with quick-win pilots.",
      businessContext: {
        industries: "Retail and e-commerce",
        strategicGoals:
          "Grow direct-to-consumer channels, increase conversion, reduce churn, and improve margins",
        businessPriorities: "Increase Revenue, Protect Revenue",
        strategicInitiative: "",
        valueChain: "",
        revenueModel: "",
        additionalContext: "",
      },
      useCaseCount: 18,
      domainCount: 6,
      aiCount: 11,
      statsCount: 7,
      avgScore: 57,
      businessPriorities: [
        "Increase Revenue",
        "Optimize Operations",
        "Enhance Experience",
        "Mitigate Risk",
      ],
    });

    expect(lines[0]).toMatchObject({
      kind: "narrative",
    });
    expect(
      lines.some((line) => line.text.includes("18 use cases discovered across 6 domains")),
    ).toBe(true);
  });

  it("paginates in stable order with no empty pages", () => {
    const lines: ExecutiveSummaryLine[] = Array.from({ length: 14 }).map((_, i) => ({
      kind: "bullet",
      text: `Line ${i + 1} with enough text to span and test ordering across page boundaries`,
    }));

    const pages = paginateSummaryItems(lines, {
      availableHeight: 1.0,
      contentWidth: 4.5,
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length > 0)).toBe(true);
    expect(pages.flat().map((line) => line.text)).toEqual(lines.map((line) => line.text));
  });

  it("moves trailing orphan line to prior page when space allows", () => {
    const lines: ExecutiveSummaryLine[] = [
      { kind: "bullet", text: "First line has enough words to consume moderate vertical space." },
      { kind: "bullet", text: "Second line has enough words to consume moderate vertical space." },
      { kind: "bullet", text: "Short tail" },
    ];

    const pages = paginateSummaryItems(lines, {
      availableHeight: 1.4,
      contentWidth: 7.5,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(3);
  });
});
