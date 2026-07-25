import { describe, it, expect } from "vitest";
import {
  buildDomains,
  buildSubdomains,
  tablesIn,
  metricValue,
  catalogOf,
  schemaOf,
  shortName,
  packCircles,
  colorMap,
  toNum,
  tableStorageFeatures,
  fitCircleLabel,
  UNCLASSIFIED,
  UNGROUPED,
  type Metric,
} from "@/lib/environment/domain-explorer";
import type { TableDetailRow } from "@/app/environment/types";

function row(p: Partial<TableDetailRow> & { tableFqn: string }): TableDetailRow {
  return {
    tableType: "TABLE",
    dataDomain: null,
    dataSubdomain: null,
    dataTier: null,
    format: null,
    owner: null,
    sizeInBytes: null,
    numRows: null,
    numFiles: null,
    isManaged: true,
    comment: null,
    generatedDescription: null,
    sensitivityLevel: null,
    governancePriority: null,
    governanceScore: null,
    lastModified: null,
    discoveredVia: "selected",
    ...p,
  };
}

const DETAILS: TableDetailRow[] = [
  row({ tableFqn: "main.sales.orders", dataDomain: "Sales", dataSubdomain: "Orders", numRows: "1000", sizeInBytes: "5000" }),
  row({ tableFqn: "main.sales.order_lines", dataDomain: "Sales", dataSubdomain: "Orders", numRows: "5000", sizeInBytes: "9000" }),
  row({ tableFqn: "main.sales.customers", dataDomain: "Sales", dataSubdomain: "Customers", numRows: "200", sizeInBytes: "800" }),
  row({ tableFqn: "fin.gl.ledger", dataDomain: "Finance", dataSubdomain: null, numRows: "300", sizeInBytes: "1200" }),
  row({ tableFqn: "main.tmp.scratch", dataDomain: null, numRows: "10", sizeInBytes: "50" }),
];

describe("domain-explorer pure helpers", () => {
  it("toNum coerces strings, nulls, and bad values", () => {
    expect(toNum("42")).toBe(42);
    expect(toNum(7)).toBe(7);
    expect(toNum(null)).toBe(0);
    expect(toNum("nope")).toBe(0);
  });

  it("fqn parsing", () => {
    expect(catalogOf("main.sales.orders")).toBe("main");
    expect(schemaOf("main.sales.orders")).toBe("main.sales");
    expect(shortName("main.sales.orders")).toBe("orders");
  });

  it("buildDomains groups and sums, blank → Unclassified", () => {
    const domains = buildDomains(DETAILS);
    const byName = new Map(domains.map((d) => [d.name, d]));
    expect(byName.get("Sales")!.tableCount).toBe(3);
    expect(byName.get("Sales")!.totalRows).toBe(6200);
    expect(byName.get("Sales")!.totalBytes).toBe(14800);
    expect(byName.get("Finance")!.tableCount).toBe(1);
    expect(byName.has(UNCLASSIFIED)).toBe(true);
    expect(byName.get(UNCLASSIFIED)!.tableCount).toBe(1);
  });

  it("buildSubdomains scopes to a domain, blank → Ungrouped", () => {
    const subs = buildSubdomains(DETAILS, "Sales");
    const byName = new Map(subs.map((s) => [s.name, s]));
    expect(new Set(byName.keys())).toEqual(new Set(["Orders", "Customers"]));
    expect(byName.get("Orders")!.tableCount).toBe(2);
    expect(byName.get("Orders")!.totalRows).toBe(6000);

    const finSubs = buildSubdomains(DETAILS, "Finance");
    expect(finSubs).toHaveLength(1);
    expect(finSubs[0].name).toBe(UNGROUPED);
  });

  it("tablesIn filters + sorts heaviest first", () => {
    const t = tablesIn(DETAILS, "Sales", "Orders");
    expect(t.map((x) => shortName(x.tableFqn))).toEqual(["order_lines", "orders"]);

    const all = tablesIn(DETAILS, "Sales");
    expect(all).toHaveLength(3);
    expect(shortName(all[0].tableFqn)).toBe("order_lines");
  });

  it("metricValue switches by metric", () => {
    const node = { tableCount: 3, totalRows: 6200, totalBytes: 14800 };
    const cases: Array<[Metric, number]> = [
      ["rows", 6200],
      ["size", 14800],
      ["tables", 3],
    ];
    for (const [m, v] of cases) expect(metricValue(node, m)).toBe(v);
  });

  it("packCircles is deterministic, bounded, largest-first", () => {
    const packed = packCircles(
      [
        { key: "a", value: 100 },
        { key: "b", value: 10 },
        { key: "c", value: 1 },
        { key: "z", value: 0 },
      ],
      800,
      400,
    );
    expect(packed.map((p) => p.key)).toEqual(["a", "b", "c"]); // 0-value dropped, sorted desc
    expect(packed[0].r).toBeGreaterThanOrEqual(packed[1].r);
    for (const p of packed) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(-1);
      expect(p.x + p.r).toBeLessThanOrEqual(801);
      expect(p.y - p.r).toBeGreaterThanOrEqual(-1);
      expect(p.y + p.r).toBeLessThanOrEqual(401);
    }
  });

  it("packCircles returns empty when nothing positive", () => {
    expect(packCircles([{ key: "a", value: 0 }], 100, 100)).toEqual([]);
  });

  it("colorMap is stable by sorted name", () => {
    const m1 = colorMap(["Sales", "Finance", "Sales"]);
    const m2 = colorMap(["Finance", "Sales"]);
    expect(m1.get("Finance")).toBe(m2.get("Finance"));
    expect(m1.get("Sales")).toBe(m2.get("Sales"));
    expect(m1.get("Finance")).not.toBe(m1.get("Sales"));
  });

  it("tableStorageFeatures reads clustering columns + delta properties", () => {
    const t = row({
      tableFqn: "main.sales.orders",
      clusteringColumns: JSON.stringify(["order_date", "region"]),
      propertiesJson: JSON.stringify({
        "delta.enableDeletionVectors": "true",
        "delta.enableChangeDataFeed": "true",
        "delta.autoOptimize.optimizeWrite": "true",
      }),
    });
    const feat = tableStorageFeatures(t);
    expect(feat.liquidClustering).toBe(true);
    expect(feat.clusterKeys).toEqual(["order_date", "region"]);
    expect(feat.deletionVectors).toBe(true);
    expect(feat.cdf).toBe(true);
    expect(feat.autoOptimize).toBe(true);
  });

  it("tableStorageFeatures defaults to false on missing/blank metadata", () => {
    const feat = tableStorageFeatures(row({ tableFqn: "main.sales.plain" }));
    expect(feat.liquidClustering).toBe(false);
    expect(feat.clusterKeys).toEqual([]);
    expect(feat.deletionVectors).toBe(false);
    expect(feat.cdf).toBe(false);
    expect(feat.autoOptimize).toBe(false);
  });

  it("tableStorageFeatures honours the persisted cdfEnabled flag + malformed json", () => {
    const feat = tableStorageFeatures(
      row({ tableFqn: "main.sales.flagged", cdfEnabled: true, propertiesJson: "{not json" }),
    );
    expect(feat.cdf).toBe(true);
    expect(feat.deletionVectors).toBe(false);
  });

  it("fitCircleLabel keeps short names on one line", () => {
    const { lines } = fitCircleLabel("orders", 80, 12);
    expect(lines).toEqual(["orders"]);
  });

  it("fitCircleLabel wraps long names on a separator for big circles", () => {
    const { lines } = fitCircleLabel("sales_transactions", 60, 12);
    expect(lines).toHaveLength(2);
    expect(lines.join("")).toContain("sales_");
    // Reassembling the (non-ellipsised) split reproduces the original.
    expect(lines.join("").replace(/…/g, "")).not.toContain(" ");
  });

  it("fitCircleLabel ellipsises in tight circles", () => {
    const { lines } = fitCircleLabel("sales_transactions", 18, 12);
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("…")).toBe(true);
  });
});
