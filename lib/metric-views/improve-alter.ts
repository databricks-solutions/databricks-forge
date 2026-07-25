import type { SqlResult } from "@/lib/dbx/sql";
import { validateFqn, validateIdentifier } from "@/lib/validation";
import type { MetricViewDefinition } from "./definition";
import { parseMetricViewDdlEnvelope } from "./ddl-envelope";
import { parseMetricViewYaml } from "./parser";
import { serializeMetricViewYaml } from "./serializer";

function exactTarget(fqn: string): { normalized: string; quoted: string; name: string } {
  const normalized = validateFqn(fqn, "metric view improvement target");
  const parts = normalized.split(".");
  if (parts.length !== 3) throw new Error("Metric view improvement target must be a 3-part FQN.");
  const validated = parts.map((part, index) =>
    validateIdentifier(part, `metric view improvement target segment ${index + 1}`),
  );
  return {
    normalized: validated.join("."),
    quoted: validated.map((part) => `\`${part}\``).join("."),
    name: validated[2],
  };
}

export function buildMetricViewAlterStatement(
  existingFqn: string,
  definition: MetricViewDefinition,
): string {
  const target = exactTarget(existingFqn);
  const yaml = serializeMetricViewYaml(definition);
  if (yaml.includes("$$")) {
    throw new Error(
      "Metric view YAML contains the reserved outer DDL delimiter ($$); ALTER was not emitted.",
    );
  }
  return `ALTER VIEW ${target.quoted} AS $$\n${yaml}$$`;
}

export function parseMetricViewShowCreate(
  result: SqlResult,
  expectedFqn: string,
): MetricViewDefinition {
  const target = exactTarget(expectedFqn);
  const ddl = result.rows.flat().find((value) => /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/i.test(value));
  if (!ddl) throw new Error("SHOW CREATE did not return readable metric view DDL.");
  const envelope = parseMetricViewDdlEnvelope(ddl);
  if (envelope.targetFqn.toLowerCase() !== target.normalized.toLowerCase()) {
    throw new Error("SHOW CREATE metric view target does not match the exact stored FQN.");
  }
  const yaml = ddl.slice(envelope.bodyStart, envelope.closingDelimiterOffset).trim();
  if (!yaml) throw new Error("SHOW CREATE returned an empty metric view definition.");
  return parseMetricViewYaml(yaml, target.name);
}
