import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildDataGapWorkbook } from "@/lib/export/data-gap-excel";
import type { DataGapResult } from "@/lib/engines/data-gap-analysis/types";

function makeResult(): DataGapResult {
  return {
    industryId: "retail",
    industryName: "Retail & Consumer Goods",
    generatedAt: "2026-05-21T12:00:00Z",
    summary: {
      industryId: "retail",
      industryName: "Retail & Consumer Goods",
      totalAssets: 12,
      presentAssets: 5,
      missingAssets: 7,
      mcCovered: 8,
      mcMissing: 12,
      vaCovered: 3,
      vaMissing: 9,
      mcCoveragePct: 0.4,
      valueAtRiskLow: 1_000_000,
      valueAtRiskMid: 3_500_000,
      valueAtRiskHigh: 7_000_000,
    },
    coverage: [
      {
        assetId: "customer-master",
        assetName: "Customer Master Data",
        assetFamily: "Customer Data",
        systemLocation: "CRM",
        systemKind: "CRM",
        present: false,
        matchedTables: [],
        mcUseCaseCount: 3,
        vaUseCaseCount: 2,
        mcUseCaseNames: ["Personalization", "Churn"],
        recommendations: [
          {
            strategy: "lakeflow_connect",
            rating: "High",
            rationale: "Source: Salesforce (confirmed from your lineage).",
          },
          { strategy: "uc_federation", rating: "Low", rationale: "Generic." },
        ],
        resolvedSourceSystems: [
          {
            name: "Salesforce",
            origin: "lineage",
            systemKind: "CRM",
            preferredStrategy: "lakeflow_connect",
          },
        ],
      },
      {
        assetId: "product-catalog",
        assetName: "Product Catalog",
        assetFamily: "Product Data",
        systemLocation: "ERP",
        systemKind: "ERP",
        present: false,
        matchedTables: [],
        mcUseCaseCount: 2,
        vaUseCaseCount: 1,
        mcUseCaseNames: ["Demand Forecast"],
        recommendations: [
          {
            strategy: "lakebridge_migrate",
            rating: "High",
            rationale: "Typical for ERP systems — confirm vendor.",
          },
        ],
        resolvedSourceSystems: [
          {
            name: "ERP systems",
            origin: "master-repo",
            systemKind: "ERP",
            preferredStrategy: "lakebridge_migrate",
            exampleVendors: ["SAP", "Oracle EBS", "NetSuite"],
          },
        ],
      },
    ],
    valueAtRisk: [
      {
        assetId: "customer-master",
        assetName: "Customer Master Data",
        blockedUseCases: ["Personalization", "Churn"],
        reducedUseCases: ["Loyalty Program"],
        impactedUseCases: [
          {
            useCaseId: "uc1",
            name: "Personalization",
            criticality: "MC",
            valueLow: 200_000,
            valueMid: 600_000,
            valueHigh: 1_200_000,
          },
        ],
        byImpactCategory: {
          Revenue: { low: 200_000, mid: 600_000, high: 1_200_000 },
        },
        totalLow: 200_000,
        totalMid: 600_000,
        totalHigh: 1_200_000,
      },
      {
        assetId: "product-catalog",
        assetName: "Product Catalog",
        blockedUseCases: ["Demand Forecast"],
        reducedUseCases: [],
        impactedUseCases: [
          {
            useCaseId: "uc2",
            name: "Demand Forecast",
            criticality: "MC",
            valueLow: 100_000,
            valueMid: 300_000,
            valueHigh: 600_000,
          },
        ],
        byImpactCategory: {
          Revenue: { low: 100_000, mid: 300_000, high: 600_000 },
        },
        totalLow: 100_000,
        totalMid: 300_000,
        totalHigh: 600_000,
      },
    ],
  };
}

async function loadWorkbook(): Promise<ExcelJS.Workbook> {
  const buf = await buildDataGapWorkbook(makeResult());
  const wb = new ExcelJS.Workbook();
  // ExcelJS's `.xlsx.load()` typing demands a Node Buffer; convert here so
  // production code can keep the more portable ArrayBuffer contract.
  // `Buffer.from(ArrayBuffer)` is the documented Node entry point.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(buf) as any);
  return wb;
}

describe("buildDataGapWorkbook", () => {
  it("produces a workbook with all 5 sheets in sales reading order", async () => {
    const wb = await loadWorkbook();
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      "Onboarding Plan",
      "Asset Coverage",
      "Value at Risk",
      "Use Case Mapping",
      "Summary",
    ]);
  });

  it("Onboarding Plan sheet leads with the highest-value system", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Onboarding Plan");
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBeGreaterThanOrEqual(2);
    const firstDataRow = sheet!.getRow(2);
    // Salesforce ($600K) outranks ERP systems ($300K) so it sorts first.
    expect(firstDataRow.getCell(2).value).toBe("Salesforce");
    expect(firstDataRow.getCell(3).value).toBe("Lineage-confirmed");
    expect(firstDataRow.getCell(4).value).toBe("Lakeflow Connect");
  });

  it("Onboarding Plan renders master-repo rows as 'category (e.g. examples)' with 'typical for X' path", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Onboarding Plan");
    expect(sheet).toBeDefined();
    // Second data row = ERP systems (master-repo).
    const erpRow = sheet!.getRow(3);
    expect(erpRow.getCell(2).value).toBe("ERP systems (e.g. SAP, Oracle EBS, NetSuite)");
    expect(erpRow.getCell(3).value).toBe("Reference architecture");
    expect(erpRow.getCell(4).value).toBe("Lakebridge Migrate (typical for ERP systems)");
  });

  it("Onboarding Plan appends a 3-row confidence legend at the bottom of the sheet", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Onboarding Plan");
    expect(sheet).toBeDefined();
    // Walk every row and collect first-column labels. Look for the legend header.
    const labelsCol1: Array<unknown> = [];
    for (let r = 1; r <= sheet!.rowCount; r++) {
      labelsCol1.push(sheet!.getCell(r, 1).value);
    }
    expect(labelsCol1).toContain("Confidence legend");
    expect(labelsCol1).toContain("Lineage-confirmed");
    expect(labelsCol1).toContain("Reference architecture");
    expect(labelsCol1).toContain("Unconfirmed");
  });

  it("Asset Coverage sheet renders master-repo source as 'category (e.g. examples)'", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Asset Coverage");
    expect(sheet).toBeDefined();
    // Find the Product Catalog row (assetId is column 1).
    let productRowIdx = -1;
    for (let r = 2; r <= sheet!.rowCount; r++) {
      if (sheet!.getCell(r, 1).value === "product-catalog") {
        productRowIdx = r;
        break;
      }
    }
    expect(productRowIdx).toBeGreaterThan(1);
    expect(sheet!.getCell(productRowIdx, 8).value).toBe(
      "ERP systems (e.g. SAP, Oracle EBS, NetSuite)",
    );
  });

  it("Asset Coverage sheet flags both rows as Missing (lineage Salesforce + ref-arch ERP)", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Asset Coverage");
    expect(sheet).toBeDefined();
    const statuses = [sheet!.getRow(2).getCell(4).value, sheet!.getRow(3).getCell(4).value];
    expect(statuses.every((s) => s === "Missing")).toBe(true);
  });

  it("Summary sheet carries the industry name + total VA-R in currency format", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const industryRow = sheet!.getRow(2);
    expect(industryRow.getCell(2).value).toBe("Retail & Consumer Goods");
    const lastRow = sheet!.lastRow!;
    expect(lastRow.getCell(2).value).toBe(7_000_000);
    expect(lastRow.getCell(2).numFmt).toBe('"$"#,##0');
  });

  it("Use Case Mapping sheet emits one row per (use case, asset) pair", async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet("Use Case Mapping");
    expect(sheet).toBeDefined();
    // 2 blocked + 1 reduced for customer-master = 3 rows + header
    expect(sheet!.rowCount).toBeGreaterThanOrEqual(4);
    expect(sheet!.getRow(2).getCell(3).value).toBe("MC");
    expect(sheet!.getRow(4).getCell(3).value).toBe("VA");
  });
});
