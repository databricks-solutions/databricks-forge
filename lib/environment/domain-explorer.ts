/**
 * Pure helpers for the Estate Domain Explorer (progressive-zoom bubble map).
 *
 * Zero React / DOM / network dependencies so the grouping + circle-packing
 * logic is unit-testable in isolation. The explorer walks three levels —
 * domain → subdomain → table — all derived client-side from the
 * `TableDetailRow[]` the estate view already holds.
 */

import type { TableDetailRow } from "@/app/environment/types";

export type Metric = "rows" | "tables" | "size";
export type ColorBy = "tier" | "catalog";
export type ExplorerLevel = "domains" | "subdomains" | "tables";

export const UNCLASSIFIED = "Unclassified";
export const UNGROUPED = "Ungrouped";

/** A grouped node at the domain or subdomain level. */
export interface GroupNode {
  /** Stable identity (domain name, or `${domain}/${subdomain}`). */
  key: string;
  /** Display label. */
  name: string;
  tableCount: number;
  totalRows: number;
  totalBytes: number;
  tables: TableDetailRow[];
}

export function toNum(s: string | number | null | undefined): number {
  if (s == null) return 0;
  const n = typeof s === "string" ? Number(s) : s;
  return Number.isFinite(n) ? n : 0;
}

/** First segment of a FQN (catalog). */
export function catalogOf(fqn: string): string {
  return fqn.split(".")[0] ?? fqn;
}

/** `catalog.schema` prefix of a FQN. */
export function schemaOf(fqn: string): string {
  const parts = fqn.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : fqn;
}

/** Short (last-segment) table name from a FQN. */
export function shortName(fqn: string): string {
  return fqn.split(".").pop() ?? fqn;
}

/** The raw metric value for a node. */
export function metricValue(
  n: Pick<GroupNode, "tableCount" | "totalRows" | "totalBytes">,
  metric: Metric,
): number {
  if (metric === "rows") return n.totalRows;
  if (metric === "size") return n.totalBytes;
  return n.tableCount;
}

function emptyNode(key: string, name: string): GroupNode {
  return { key, name, tableCount: 0, totalRows: 0, totalBytes: 0, tables: [] };
}

function accumulate(node: GroupNode, d: TableDetailRow): void {
  node.tableCount += 1;
  node.totalRows += toNum(d.numRows);
  node.totalBytes += toNum(d.sizeInBytes);
  node.tables.push(d);
}

/** Group all tables by `dataDomain` (blank → Unclassified). */
export function buildDomains(details: TableDetailRow[]): GroupNode[] {
  const map = new Map<string, GroupNode>();
  for (const d of details) {
    const name = d.dataDomain?.trim() || UNCLASSIFIED;
    let node = map.get(name);
    if (!node) {
      node = emptyNode(name, name);
      map.set(name, node);
    }
    accumulate(node, d);
  }
  return [...map.values()];
}

/** Tables within a single domain, grouped by `dataSubdomain` (blank → Ungrouped). */
export function buildSubdomains(details: TableDetailRow[], domain: string): GroupNode[] {
  const map = new Map<string, GroupNode>();
  for (const d of details) {
    const dom = d.dataDomain?.trim() || UNCLASSIFIED;
    if (dom !== domain) continue;
    const sub = d.dataSubdomain?.trim() || UNGROUPED;
    let node = map.get(sub);
    if (!node) {
      node = emptyNode(`${domain}/${sub}`, sub);
      map.set(sub, node);
    }
    accumulate(node, d);
  }
  return [...map.values()];
}

/**
 * Tables for a domain (and optional subdomain), sorted heaviest-rows first so
 * the largest tables surface at the top of the list / leaf level.
 */
export function tablesIn(
  details: TableDetailRow[],
  domain: string,
  subdomain?: string | null,
): TableDetailRow[] {
  const out = details.filter((d) => {
    const dom = d.dataDomain?.trim() || UNCLASSIFIED;
    if (dom !== domain) return false;
    if (subdomain == null) return true;
    const sub = d.dataSubdomain?.trim() || UNGROUPED;
    return sub === subdomain;
  });
  return out.sort((a, b) => toNum(b.numRows) - toNum(a.numRows));
}

// ---------------------------------------------------------------------------
// Circle packing (generic, deterministic spiral placement + bbox rescale)
// ---------------------------------------------------------------------------

export interface PackItem {
  key: string;
  value: number;
}

export interface PackedCircle {
  key: string;
  x: number;
  y: number;
  r: number;
  value: number;
}

/**
 * Pack circles whose areas are proportional to `value` via spiral placement
 * with collision avoidance, then rescale the bounding box to fit `width` ×
 * `height`. Items with value ≤ 0 are dropped. Deterministic for a given input
 * order (callers sort first for stable colour/position).
 */
export function packCircles(items: PackItem[], width: number, height: number): PackedCircle[] {
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length === 0) return [];

  const sumVal = positive.reduce((s, i) => s + i.value, 0);
  const fill = 0.6; // target area fraction before rescale
  const scale = Math.sqrt((fill * width * height) / (Math.PI * sumVal));
  const minR = 10;
  const radii = positive.map((i) => Math.max(minR, Math.sqrt(i.value) * scale));

  const placed: Array<{ x: number; y: number; r: number }> = [];
  const pad = 4;
  for (let idx = 0; idx < positive.length; idx++) {
    const r = radii[idx];
    if (idx === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    let spot: { x: number; y: number } | null = null;
    const b = Math.max(1.5, r * 0.08);
    for (let t = 0; t < 6000; t++) {
      const ang = t * 0.25;
      const rad = b * ang * 0.12;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      let ok = true;
      for (const p of placed) {
        if (Math.hypot(x - p.x, y - p.y) < r + p.r + pad) {
          ok = false;
          break;
        }
      }
      if (ok) {
        spot = { x, y };
        break;
      }
    }
    placed.push({ x: spot?.x ?? 0, y: spot?.y ?? 0, r });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const margin = 14;
  const k = Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh);
  const offX = (width - bw * k) / 2 - minX * k;
  const offY = (height - bh * k) / 2 - minY * k;

  return positive.map((it, i) => ({
    key: it.key,
    value: it.value,
    x: placed[i].x * k + offX,
    y: placed[i].y * k + offY,
    r: placed[i].r * k,
  }));
}

// ---------------------------------------------------------------------------
// Storage-engine signals (for the leaf tooltip / detail panel)
// ---------------------------------------------------------------------------

export interface StorageFeatures {
  /** Liquid clustering is on when DESCRIBE DETAIL reported clustering columns. */
  liquidClustering: boolean;
  clusterKeys: string[];
  /** `delta.enableDeletionVectors=true` in table properties. */
  deletionVectors: boolean;
  /** Change Data Feed (`delta.enableChangeDataFeed`). */
  cdf: boolean;
  /** Optimized writes / auto-compaction. */
  autoOptimize: boolean;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseProps(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const TRUTHY = new Set(["true", "1", "yes", "enabled"]);

/** Derive storage-engine features from a persisted table row. */
export function tableStorageFeatures(t: TableDetailRow): StorageFeatures {
  const clusterKeys = parseJsonArray(t.clusteringColumns);
  // Normalize property keys to lowercase so camelCase Delta keys
  // (e.g. `delta.enableDeletionVectors`) match regardless of casing.
  const raw = parseProps(t.propertiesJson);
  const props = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    props.set(k.toLowerCase(), (v ?? "").toString().trim().toLowerCase());
  }
  const on = (k: string) => TRUTHY.has(props.get(k) ?? "");
  return {
    liquidClustering: clusterKeys.length > 0 || on("clusteringcolumns"),
    clusterKeys,
    deletionVectors: on("delta.enabledeletionvectors"),
    cdf: t.cdfEnabled === true || on("delta.enablechangedatafeed"),
    autoOptimize:
      t.autoOptimize === true ||
      on("delta.autooptimize.optimizewrite") ||
      on("delta.autooptimize.autocompact"),
  };
}

// ---------------------------------------------------------------------------
// Label fitting (wrap a name to fit inside a circle, never hard-truncating
// when a clean two-line split is possible)
// ---------------------------------------------------------------------------

/**
 * Fit `name` to the chord width of a circle of radius `r`, wrapping onto up to
 * `maxLines` lines (splitting on `_`, `.`, `-`, or space boundaries). Falls
 * back to an ellipsis only when even the wrapped form overflows.
 */
export function fitCircleLabel(
  name: string,
  r: number,
  fontSize: number,
  maxLines = 2,
): { lines: string[]; fontSize: number } {
  const charW = fontSize * 0.58;
  // Usable width across the circle (chord a bit inside the edge).
  const maxChars = Math.max(3, Math.floor((r * 1.7) / charW));

  if (name.length <= maxChars) return { lines: [name], fontSize };
  if (maxLines < 2 || r < 30) {
    return { lines: [`${name.slice(0, Math.max(1, maxChars - 1))}…`], fontSize };
  }

  // Try to split on a natural boundary nearest the middle.
  const seps = ["_", ".", "-", " "];
  let splitAt = -1;
  let best = Infinity;
  for (let i = 1; i < name.length - 1; i++) {
    if (seps.includes(name[i])) {
      const dist = Math.abs(i - name.length / 2);
      if (dist < best) {
        best = dist;
        splitAt = i;
      }
    }
  }

  let first: string;
  let second: string;
  if (splitAt > 0) {
    first = name.slice(0, splitAt + 1); // keep separator on first line
    second = name.slice(splitAt + 1);
  } else {
    const mid = Math.ceil(name.length / 2);
    first = name.slice(0, mid);
    second = name.slice(mid);
  }

  const clamp = (s: string) => (s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s);
  return { lines: [clamp(first), clamp(second)], fontSize };
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Palette legible on light + dark surfaces. */
export const PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
];

/** Medallion tier colours. */
export const TIER_COLOR: Record<string, string> = {
  gold: "#f59e0b",
  silver: "#94a3b8",
  bronze: "#d97706",
  system: "#6366f1",
};

/** Stable colour map for a set of names (assigned by sorted order). */
export function colorMap(names: string[]): Map<string, string> {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const m = new Map<string, string>();
  sorted.forEach((n, i) => m.set(n, PALETTE[i % PALETTE.length]));
  return m;
}
