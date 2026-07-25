import type { BusinessContext } from "@/lib/domain/types";

export type ExecutiveSummaryLineKind = "narrative" | "bullet" | "sub-bullet";

export interface ExecutiveSummaryLine {
  text: string;
  kind: ExecutiveSummaryLineKind;
  keepWithNext?: boolean;
}

interface SplitFieldOptions {
  label: string;
  value: string;
  splitThreshold?: number;
}

const DEFAULT_SPLIT_THRESHOLD = 170;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitBySeparator(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function groupParts(parts: string[], maxChars = 140): string[] {
  const groups: string[] = [];
  let current = "";

  for (const part of parts) {
    const next = current ? `${current}, ${part}` : part;
    if (next.length > maxChars && current) {
      groups.push(current);
      current = part;
    } else {
      current = next;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function splitLongValue(value: string): string[] {
  if (/(?:\s(?:->|→)\s)/.test(value)) {
    return splitBySeparator(value, /\s*(?:->|→)\s*/);
  }
  if (value.includes(";")) {
    return splitBySeparator(value, /\s*;\s*/);
  }

  const commaParts = splitBySeparator(value, /\s*,\s*/);
  if (commaParts.length >= 4) {
    return groupParts(commaParts);
  }

  const sentenceParts = splitBySeparator(value, /(?<=[.!?])\s+(?=[A-Z])/);
  if (sentenceParts.length >= 3) {
    return sentenceParts;
  }

  return [];
}

export function splitLongFieldIntoBullets({
  label,
  value,
  splitThreshold = DEFAULT_SPLIT_THRESHOLD,
}: SplitFieldOptions): ExecutiveSummaryLine[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  if (normalized.length <= splitThreshold) {
    return [{ kind: "bullet", text: `${label}: ${normalized}` }];
  }

  const parts = splitLongValue(normalized);
  if (parts.length < 2) {
    return [{ kind: "bullet", text: `${label}: ${normalized}` }];
  }

  return [
    { kind: "bullet", text: `${label}:`, keepWithNext: true },
    ...parts.map((part) => ({ kind: "sub-bullet" as const, text: part })),
  ];
}

interface BuildExecutiveSummaryItemsArgs {
  executiveSummary?: string | null;
  businessContext?: BusinessContext | null;
  useCaseCount: number;
  domainCount: number;
  aiCount: number;
  statsCount: number;
  avgScore: number;
  businessPriorities: string[];
}

export function buildExecutiveSummaryItems(
  args: BuildExecutiveSummaryItemsArgs,
): ExecutiveSummaryLine[] {
  const items: ExecutiveSummaryLine[] = [];
  const executiveSummary = normalizeText(args.executiveSummary ?? "");
  if (executiveSummary) {
    items.push({ kind: "narrative", text: executiveSummary });
  }

  const bc = args.businessContext;
  if (bc) {
    if (bc.industries) {
      items.push(...splitLongFieldIntoBullets({ label: "Industry", value: bc.industries }));
    }
    if (bc.strategicGoals) {
      items.push(
        ...splitLongFieldIntoBullets({
          label: "Strategic Goals",
          value: bc.strategicGoals,
        }),
      );
    }
    if (bc.valueChain) {
      items.push(...splitLongFieldIntoBullets({ label: "Value Chain", value: bc.valueChain }));
    }
    if (bc.revenueModel) {
      items.push(...splitLongFieldIntoBullets({ label: "Revenue Model", value: bc.revenueModel }));
    }
  }

  items.push({
    kind: "bullet",
    text: `${args.useCaseCount} use cases discovered across ${args.domainCount} domains`,
  });
  items.push({
    kind: "bullet",
    text: `${args.aiCount} AI use cases, ${args.statsCount} Statistical use cases`,
  });
  items.push({ kind: "bullet", text: `Average overall score: ${args.avgScore}%` });
  items.push(
    ...splitLongFieldIntoBullets({
      label: "Business Priorities",
      value: args.businessPriorities.join(", "),
      splitThreshold: 120,
    }),
  );

  return items;
}

interface PaginationOptions {
  availableHeight: number;
  contentWidth: number;
}

const EXEC_BULLET_LINE_HEIGHT = 0.22;
const EXEC_SUB_BULLET_LINE_HEIGHT = 0.2;
const EXEC_NARRATIVE_LINE_HEIGHT = 0.2;
const EXEC_LINE_GAP = 0.1;
const EXEC_PARAGRAPH_GAP = 0.08;

function getFontSize(kind: ExecutiveSummaryLineKind): number {
  switch (kind) {
    case "narrative":
      return 13;
    case "sub-bullet":
      return 13;
    default:
      return 14;
  }
}

function charsPerLine(width: number, fontSize: number): number {
  const base = width * 9.2;
  return Math.max(28, Math.floor(base * (14 / fontSize)));
}

export function estimateExecutiveSummaryLineHeight(
  line: ExecutiveSummaryLine,
  contentWidth: number,
): number {
  const fontSize = getFontSize(line.kind);
  const cpl = charsPerLine(contentWidth, fontSize);
  const lineCount = Math.max(1, Math.ceil(line.text.length / cpl));
  const lineHeight =
    line.kind === "narrative"
      ? EXEC_NARRATIVE_LINE_HEIGHT
      : line.kind === "sub-bullet"
        ? EXEC_SUB_BULLET_LINE_HEIGHT
        : EXEC_BULLET_LINE_HEIGHT;
  const paragraphGap = line.kind === "narrative" ? EXEC_PARAGRAPH_GAP : 0;
  return lineCount * lineHeight + EXEC_LINE_GAP + paragraphGap;
}

export function paginateSummaryItems(
  lines: ExecutiveSummaryLine[],
  options: PaginationOptions,
): ExecutiveSummaryLine[][] {
  const pages: ExecutiveSummaryLine[][] = [];
  const pageHeights: number[] = [];

  const getLineHeight = (line: ExecutiveSummaryLine): number =>
    estimateExecutiveSummaryLineHeight(line, options.contentWidth);

  let currentPage: ExecutiveSummaryLine[] = [];
  let currentHeight = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineHeight = getLineHeight(line);
    const nextLine = lines[i + 1];
    const keepTogetherHeight =
      line.keepWithNext && nextLine ? lineHeight + getLineHeight(nextLine) : lineHeight;

    if (currentPage.length > 0 && currentHeight + keepTogetherHeight > options.availableHeight) {
      pages.push(currentPage);
      pageHeights.push(currentHeight);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(line);
    currentHeight += lineHeight;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
    pageHeights.push(currentHeight);
  }

  // Keep final page from looking sparse when a trailing short line can fit prior page.
  if (pages.length > 1) {
    const lastPage = pages[pages.length - 1];
    const prevPage = pages[pages.length - 2];
    if (lastPage.length === 1) {
      const candidate = lastPage[0];
      const candidateHeight = getLineHeight(candidate);
      if (pageHeights[pages.length - 2] + candidateHeight <= options.availableHeight) {
        prevPage.push(candidate);
        pageHeights[pages.length - 2] += candidateHeight;
        pages.pop();
      }
    }
  }

  return pages;
}
