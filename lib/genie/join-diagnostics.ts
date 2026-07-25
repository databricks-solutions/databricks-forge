import { validateSqlExpression, type SchemaAllowlist } from "./schema-allowlist";
import type { JoinConfidence, JoinDiagnostic, JoinSource } from "./types";

export interface JoinCandidate {
  leftTable: string;
  rightTable: string;
  sql: string;
  relationshipType: "many_to_one" | "one_to_many" | "one_to_one";
  source: JoinSource;
  confidence: JoinConfidence;
}

const SOURCE_PRIORITY: Record<JoinSource, number> = {
  fk: 5,
  override: 4,
  sql_mined: 3,
  llm: 2,
  heuristic: 1,
};

export function evaluateJoinCandidates(
  allowlist: SchemaAllowlist,
  candidates: JoinCandidate[],
  contextPrefix: string,
): {
  accepted: JoinCandidate[];
  diagnostics: JoinDiagnostic[];
} {
  const diagnostics: JoinDiagnostic[] = [];
  const seen = new Map<string, JoinCandidate>();
  const accepted: JoinCandidate[] = [];

  for (const c of candidates) {
    const pair = `${c.leftTable.toLowerCase()}|${c.rightTable.toLowerCase()}`;
    const reverse = `${c.rightTable.toLowerCase()}|${c.leftTable.toLowerCase()}`;
    const existing = seen.get(pair) ?? seen.get(reverse);
    if (existing) {
      if (SOURCE_PRIORITY[c.source] > SOURCE_PRIORITY[existing.source]) {
        const existingIdx = accepted.findIndex(
          (a) =>
            (a.leftTable.toLowerCase() === existing.leftTable.toLowerCase() &&
              a.rightTable.toLowerCase() === existing.rightTable.toLowerCase()) ||
            (a.leftTable.toLowerCase() === existing.rightTable.toLowerCase() &&
              a.rightTable.toLowerCase() === existing.leftTable.toLowerCase()),
        );
        if (existingIdx >= 0) accepted.splice(existingIdx, 1);
        diagnostics.push({
          status: "rejected",
          source: existing.source,
          confidence: existing.confidence,
          leftTable: existing.leftTable,
          rightTable: existing.rightTable,
          sql: existing.sql,
          reason: "superseded_by_higher_priority_source",
        });
      } else {
        diagnostics.push({
          status: "rejected",
          source: c.source,
          confidence: c.confidence,
          leftTable: c.leftTable,
          rightTable: c.rightTable,
          sql: c.sql,
          reason: "duplicate_pair_lower_priority",
        });
        continue;
      }
    }

    if (
      !validateSqlExpression(
        allowlist,
        c.sql,
        `${contextPrefix}:${c.leftTable}->${c.rightTable}`,
        true,
      )
    ) {
      diagnostics.push({
        status: "rejected",
        source: c.source,
        confidence: c.confidence,
        leftTable: c.leftTable,
        rightTable: c.rightTable,
        sql: c.sql,
        reason: "invalid_sql_expression",
      });
      continue;
    }

    seen.set(pair, c);
    accepted.push(c);
    diagnostics.push({
      status: "accepted",
      source: c.source,
      confidence: c.confidence,
      leftTable: c.leftTable,
      rightTable: c.rightTable,
      sql: c.sql,
      reason: "validated",
    });
  }

  return { accepted, diagnostics };
}
