import {
  runMetricViewEngineV2,
  type MetricViewEngineV2Input,
  type MetricViewEngineV2Output,
} from "./engine";
import type { MetricViewDeploymentTarget } from "./legacy-adapter";
import type { MetadataSnapshot } from "@/lib/domain/types";
import type { MetricViewProposal } from "./types";
import { buildSchemaAllowlist } from "@/lib/genie/schema-allowlist";
import { evidenceFailed } from "@/lib/validation/evidence";
import { parseMetricViewDdlEnvelope } from "./ddl-envelope";
import { validateIdentifier } from "@/lib/validation";
import { logger } from "@/lib/logger";

type TypedRunner = (input: MetricViewEngineV2Input) => Promise<MetricViewEngineV2Output>;

function targetOf(tableFqn: string): MetricViewDeploymentTarget {
  const parts = tableFqn.replaceAll("`", "").split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error(
      `Typed metric-view generation requires a catalog.schema.table FQN: ${tableFqn}`,
    );
  }
  return { catalog: parts[0], schema: parts[1] };
}

function targetKey(target: MetricViewDeploymentTarget): string {
  return `${target.catalog}.${target.schema}`.toLowerCase();
}

function sourceTables(input: MetricViewEngineV2Input): string[] {
  return [
    ...(input.tableFqns ?? []),
    ...input.useCases.flatMap((useCase) => useCase.tablesInvolved ?? []),
    ...(input.dataDomains ?? []).flatMap((dataDomain) => dataDomain.tables),
  ];
}

function metadataForPartition(
  metadata: MetadataSnapshot,
  target: MetricViewDeploymentTarget,
  tableSet: Set<string>,
): MetadataSnapshot {
  const schemaKey = targetKey(target);
  const tables = metadata.tables.filter((table) => tableSet.has(table.fqn.toLowerCase()));
  const columns = metadata.columns.filter((column) => tableSet.has(column.tableFqn.toLowerCase()));
  return {
    ...metadata,
    cacheKey: `${metadata.cacheKey}:${schemaKey}`,
    ucPath: `${target.catalog}.${target.schema}`,
    tables,
    columns,
    foreignKeys: metadata.foreignKeys.filter(
      (foreignKey) =>
        tableSet.has(foreignKey.tableFqn.toLowerCase()) &&
        tableSet.has(foreignKey.referencedTableFqn.toLowerCase()),
    ),
    metricViews: metadata.metricViews.filter((metricView) =>
      metricView.fqn.toLowerCase().startsWith(`${schemaKey}.`),
    ),
    schemaMarkdown: undefined,
    tableCount: tables.length,
    columnCount: columns.length,
    lineageDiscoveredFqns: metadata.lineageDiscoveredFqns.filter((fqn) =>
      tableSet.has(fqn.toLowerCase()),
    ),
  };
}

const SQL_KEYWORDS = new Set([
  "all",
  "and",
  "as",
  "asc",
  "between",
  "by",
  "case",
  "current_date",
  "current_timestamp",
  "desc",
  "distinct",
  "else",
  "end",
  "false",
  "filter",
  "following",
  "from",
  "in",
  "is",
  "like",
  "not",
  "null",
  "nulls",
  "or",
  "over",
  "partition",
  "preceding",
  "range",
  "rows",
  "then",
  "true",
  "unbounded",
  "when",
]);

interface SqlIdentifierToken {
  value: string;
  start: number;
  end: number;
}

interface ExpressionGrounding {
  tableTargets: Map<string, string>;
  qualificationTables: Map<string, Set<string>>;
  tableColumns: Map<string, Set<string>>;
  columnTargets: Map<string, Set<string>>;
}

function addOwner(index: Map<string, Set<string>>, name: string, target: string): void {
  const owners = index.get(name) ?? new Set<string>();
  owners.add(target);
  index.set(name, owners);
}

function buildExpressionGrounding(
  metadata: MetadataSnapshot,
  tables: string[],
): ExpressionGrounding {
  const tableTargets = new Map<string, string>();
  const qualificationTables = new Map<string, Set<string>>();
  const tableColumns = new Map<string, Set<string>>();
  for (const table of tables) {
    const normalized = table.replaceAll("`", "").toLowerCase();
    const target = targetKey(targetOf(normalized));
    tableTargets.set(normalized, target);
    const parts = normalized.split(".");
    addOwner(qualificationTables, parts[2], normalized);
    addOwner(qualificationTables, `${parts[1]}.${parts[2]}`, normalized);
    addOwner(qualificationTables, normalized, normalized);
  }
  const columnTargets = new Map<string, Set<string>>();
  for (const column of metadata.columns) {
    const table = column.tableFqn.replaceAll("`", "").toLowerCase();
    const target = tableTargets.get(table);
    if (!target) continue;
    const columnName = column.columnName.toLowerCase();
    addOwner(columnTargets, columnName, target);
    addOwner(tableColumns, table, columnName);
  }
  return { tableTargets, qualificationTables, tableColumns, columnTargets };
}

function sqlIdentifierTokens(sql: string): SqlIdentifierToken[] {
  const tokens: SqlIdentifierToken[] = [];
  for (let index = 0; index < sql.length; ) {
    const char = sql[index];
    if (char === "'" || char === '"') {
      const delimiter = char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === delimiter) {
          if (sql[index + 1] === delimiter) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "`") {
      const start = index;
      index += 1;
      let value = "";
      while (index < sql.length && sql[index] !== "`") {
        value += sql[index];
        index += 1;
      }
      if (sql[index] === "`") index += 1;
      if (value) tokens.push({ value: value.toLowerCase(), start, end: index });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$-]/.test(sql[index])) index += 1;
      tokens.push({ value: sql.slice(start, index).toLowerCase(), start, end: index });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function onlyWhitespaceAndDot(sql: string, left: SqlIdentifierToken, right: SqlIdentifierToken) {
  return /^\s*\.\s*$/.test(sql.slice(left.end, right.start));
}

function expressionTarget(sql: string, grounding: ExpressionGrounding): string | null {
  const tokens = sqlIdentifierTokens(sql);
  const referencedTargets = new Set<string>();
  let foundReference = false;

  for (let index = 0; index < tokens.length; ) {
    const chain = [tokens[index]];
    let cursor = index + 1;
    while (
      cursor < tokens.length &&
      onlyWhitespaceAndDot(sql, chain[chain.length - 1], tokens[cursor])
    ) {
      chain.push(tokens[cursor]);
      cursor += 1;
    }

    if (chain.length > 4) return null;
    const column = chain[chain.length - 1].value;
    const previous = tokens[index - 1]?.value;
    const nextChar = sql.slice(chain[chain.length - 1].end).trimStart()[0];
    if (chain.length === 1 && (SQL_KEYWORDS.has(column) || previous === "as" || nextChar === "(")) {
      index = cursor;
      continue;
    }

    if (chain.length === 1 || (chain.length === 2 && chain[0].value === "source")) {
      const owners = grounding.columnTargets.get(column);
      if (!owners || owners.size !== 1) return null;
      referencedTargets.add([...owners][0]);
      foundReference = true;
    } else {
      const qualification = chain
        .slice(0, -1)
        .map((token) => token.value)
        .join(".");
      const tables = grounding.qualificationTables.get(qualification);
      if (!tables || tables.size !== 1) return null;
      const table = [...tables][0];
      if (!grounding.tableColumns.get(table)?.has(column)) return null;
      const target = grounding.tableTargets.get(table);
      if (!target) return null;
      referencedTargets.add(target);
      foundReference = true;
    }
    index = cursor;
  }

  return foundReference && referencedTargets.size === 1 ? [...referencedTargets][0] : null;
}

function expressionIsLocal(
  sql: string,
  target: MetricViewDeploymentTarget,
  grounding: ExpressionGrounding,
): boolean {
  return expressionTarget(sql, grounding) === targetKey(target);
}

function joinedSources(proposal: MetricViewProposal): string[] {
  const collect = (joins: NonNullable<MetricViewProposal["definition"]>["joins"]): string[] =>
    joins.flatMap((join) => [join.source, ...collect(join.joins)]);
  return proposal.definition ? collect(proposal.definition.joins) : [];
}

function quarantinePartitionEscapes(
  proposals: MetricViewProposal[],
  tableSet: Set<string>,
  target: MetricViewDeploymentTarget,
): MetricViewProposal[] {
  return proposals.map((proposal) => {
    if (proposal.classification === "reuse" || proposal.classification === "improve") {
      return proposal;
    }
    const referencedTables = [
      ...proposal.sourceTables,
      ...(proposal.definition?.source.kind === "table" ? [proposal.definition.source.table] : []),
      ...joinedSources(proposal),
    ];
    const escapesPartition =
      referencedTables.length === 0 ||
      referencedTables.some((table) => !tableSet.has(table.replaceAll("`", "").toLowerCase()));
    let code = "METRIC_VIEW_SCHEMA_PARTITION_ESCAPE";
    let message = "Generated metric view referenced a table outside its exact schema partition.";
    if (!escapesPartition) {
      try {
        const envelope = parseMetricViewDdlEnvelope(proposal.ddl);
        const [catalog, schema, viewName] = envelope.targetFqn.split(".");
        const proposalName = validateIdentifier(proposal.name, "metric view proposal name");
        const definitionName = proposal.definition
          ? validateIdentifier(proposal.definition.name, "metric view definition name")
          : proposalName;
        const targetMatches =
          `${catalog}.${schema}`.toLowerCase() === targetKey(target) &&
          viewName.toLowerCase() === definitionName.toLowerCase() &&
          proposalName.toLowerCase() === definitionName.toLowerCase();
        if (targetMatches) return proposal;
      } catch {
        // Fall through to fail-closed quarantine.
      }
      code = "METRIC_VIEW_DDL_TARGET_INVALID";
      message =
        "Generated metric view DDL target did not match its exact schema partition and canonical name.";
    }

    return {
      ...proposal,
      validationStatus: "error",
      validationIssues: [...proposal.validationIssues, message],
      validationEvidence: [
        ...(proposal.validationEvidence ?? []),
        evidenceFailed("metric_view_static", code, message),
      ],
      validatorVersion: undefined,
      validatedAt: undefined,
    };
  });
}

/**
 * Runs typed metric-view generation once per exact source schema.
 *
 * New proposals always receive a validated catalog.schema target matching their
 * source tables. Existing reuse/improve proposals keep their discovered FQN;
 * the target here is only the default envelope for newly generated proposals.
 */
export async function runTypedMetricViewEngineV2BySchema(
  input: MetricViewEngineV2Input,
  runner: TypedRunner = runMetricViewEngineV2,
): Promise<MetricViewEngineV2Output> {
  if (input.deploymentTarget) return runner(input);

  const tablesByTarget = new Map<
    string,
    { target: MetricViewDeploymentTarget; tables: string[] }
  >();
  for (const tableFqn of sourceTables(input)) {
    const target = targetOf(tableFqn);
    const key = targetKey(target);
    const group = tablesByTarget.get(key) ?? { target, tables: [] };
    if (!group.tables.some((table) => table.toLowerCase() === tableFqn.toLowerCase())) {
      group.tables.push(tableFqn);
    }
    tablesByTarget.set(key, group);
  }
  const grounding = buildExpressionGrounding(input.metadata, sourceTables(input));

  const outputs = await Promise.all(
    [...tablesByTarget.values()]
      .sort((left, right) => targetKey(left.target).localeCompare(targetKey(right.target)))
      .map(async ({ target, tables }) => {
        const tableSet = new Set(tables.map((table) => table.toLowerCase()));
        const schemaKey = targetKey(target);
        const metadata = metadataForPartition(input.metadata, target, tableSet);
        const measures = input.measures.filter((measure) =>
          expressionIsLocal(measure.sql, target, grounding),
        );
        const dimensions = input.dimensions.filter((dimension) =>
          expressionIsLocal(dimension.sql, target, grounding),
        );
        const partitionCounts = {
          partition: schemaKey,
          tableCount: tables.length,
          measureCount: measures.length,
          dimensionCount: dimensions.length,
        };
        logger.info("Typed metric-view partition grounding", partitionCounts);
        if (measures.length === 0) {
          logger.warn("Typed metric-view partition has no grounded measures", {
            code: "METRIC_VIEW_NO_GROUNDED_MEASURES",
            ...partitionCounts,
          });
        }
        const output = await runner({
          ...input,
          deploymentTarget: target,
          tableFqns: tables,
          metadata,
          allowlist: buildSchemaAllowlist(metadata),
          useCases: input.useCases
            .map((useCase) => ({
              ...useCase,
              tablesInvolved: (useCase.tablesInvolved ?? []).filter((table) =>
                tableSet.has(table.toLowerCase()),
              ),
            }))
            .filter((useCase) => (useCase.tablesInvolved ?? []).length > 0),
          dataDomains: input.dataDomains
            ?.map((dataDomain) => ({
              ...dataDomain,
              tables: dataDomain.tables.filter((table) => tableSet.has(table.toLowerCase())),
            }))
            .filter((dataDomain) => dataDomain.tables.length > 0),
          existingMetricViews: input.existingMetricViews.filter(
            (view) =>
              view.sourceTable !== null && targetKey(targetOf(view.sourceTable)) === schemaKey,
          ),
          joinSpecs: input.joinSpecs.filter(
            (join) =>
              tableSet.has(join.leftTable.toLowerCase()) &&
              tableSet.has(join.rightTable.toLowerCase()),
          ),
          columnEnrichments: input.columnEnrichments.filter((column) =>
            tableSet.has(column.tableFqn.toLowerCase()),
          ),
          measures,
          dimensions,
        });
        return {
          ...output,
          proposals: quarantinePartitionEscapes(output.proposals, tableSet, target),
        };
      }),
  );

  return {
    proposals: outputs.flatMap((output) => output.proposals),
    subdomainGroups: outputs.flatMap((output) => output.subdomainGroups),
    planSummary: outputs
      .map((output) => output.planSummary)
      .filter(Boolean)
      .join(" | "),
  };
}
