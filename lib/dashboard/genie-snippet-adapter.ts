import type {
  EnrichedSqlSnippetDimension,
  EnrichedSqlSnippetFilter,
  EnrichedSqlSnippetMeasure,
} from "@/lib/genie/types";

interface NormalizedGenieSnippets {
  measures: EnrichedSqlSnippetMeasure[];
  dimensions: EnrichedSqlSnippetDimension[];
  filters: EnrichedSqlSnippetFilter[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstSql(value: unknown): string | null {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  return value.map(nonEmptyString).find((entry): entry is string => entry !== null) ?? null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(nonEmptyString).filter((entry): entry is string => entry !== null);
}

function instructionsOf(value: unknown): string {
  return nonEmptyString(value) ?? stringList(value).join("\n");
}

function nameOf(entry: Record<string, unknown>): string | null {
  return (
    nonEmptyString(entry.name) ??
    nonEmptyString(entry.display_name) ??
    nonEmptyString(entry.alias)
  );
}

function isTimePeriod(entry: Record<string, unknown>, name: string, sql: string): boolean {
  if (typeof entry.isTimePeriod === "boolean") return entry.isTimePeriod;
  return /\b(date|time|day|week|month|quarter|year)\b/i.test(`${name} ${sql}`);
}

function entriesOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(recordOf).filter((entry): entry is Record<string, unknown> => entry !== null);
}

export function adaptSerializedGenieSnippets(value: unknown): NormalizedGenieSnippets {
  const snippets = recordOf(value);
  if (!snippets) return { measures: [], dimensions: [], filters: [] };

  const measures = entriesOf(snippets.measures).flatMap((entry) => {
    const name = nameOf(entry);
    const sql = firstSql(entry.sql);
    if (!name || !sql) return [];
    return [
      {
        name,
        sql,
        synonyms: stringList(entry.synonyms),
        instructions: instructionsOf(entry.instructions ?? entry.comment),
      },
    ];
  });

  const dimensions = entriesOf(snippets.expressions ?? snippets.dimensions).flatMap((entry) => {
    const name = nameOf(entry);
    const sql = firstSql(entry.sql);
    if (!name || !sql) return [];
    return [
      {
        name,
        sql,
        synonyms: stringList(entry.synonyms),
        instructions: instructionsOf(entry.instructions ?? entry.instruction ?? entry.comment),
        isTimePeriod: isTimePeriod(entry, name, sql),
      },
    ];
  });

  const filters = entriesOf(snippets.filters).flatMap((entry) => {
    const name = nameOf(entry);
    const sql = firstSql(entry.sql);
    if (!name || !sql) return [];
    return [
      {
        name,
        sql,
        synonyms: stringList(entry.synonyms),
        instructions: instructionsOf(entry.instructions ?? entry.comment),
        isTimePeriod: isTimePeriod(entry, name, sql),
      },
    ];
  });

  return { measures, dimensions, filters };
}
