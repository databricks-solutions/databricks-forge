import {
  runMetricViewProposals,
  type MetricViewProposalsInput,
  type MetricViewProposalsOutput,
} from "@/lib/genie/passes/metric-view-proposals";
import { deploymentTargetFromSchemaScope } from "./legacy-adapter";

type ProposalRunner = (input: MetricViewProposalsInput) => Promise<MetricViewProposalsOutput>;

function schemaScopeOf(tableFqn: string): string {
  const parts = tableFqn.replaceAll("`", "").split(".");
  if (parts.length !== 3) {
    throw new Error(
      `Legacy metric-view generation requires a catalog.schema.table FQN: ${tableFqn}`,
    );
  }
  return `${parts[0]}.${parts[1]}`;
}

export async function runLegacyMetricViewProposalsBySchema(
  input: MetricViewProposalsInput,
  runner: ProposalRunner = runMetricViewProposals,
): Promise<MetricViewProposalsOutput> {
  const tablesBySchema = new Map<string, string[]>();
  for (const tableFqn of input.tableFqns) {
    const schemaScope = schemaScopeOf(tableFqn);
    const tables = tablesBySchema.get(schemaScope) ?? [];
    tables.push(tableFqn);
    tablesBySchema.set(schemaScope, tables);
  }

  const outputs = await Promise.all(
    [...tablesBySchema.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([schemaScope, tableFqns]) => {
        const deploymentTarget = deploymentTargetFromSchemaScope(schemaScope);
        if (!deploymentTarget) {
          throw new Error(`Invalid legacy metric-view deployment target: ${schemaScope}`);
        }
        const tableSet = new Set(tableFqns.map((table) => table.toLowerCase()));
        return runner({
          ...input,
          deploymentTarget,
          tableFqns,
          useCases: input.useCases.filter((useCase) =>
            (useCase.tablesInvolved ?? []).some((table) => tableSet.has(table.toLowerCase())),
          ),
          joinSpecs: input.joinSpecs.filter(
            (join) =>
              tableSet.has(join.leftTable.toLowerCase()) &&
              tableSet.has(join.rightTable.toLowerCase()),
          ),
          columnEnrichments: input.columnEnrichments.filter((column) =>
            tableSet.has(column.tableFqn.toLowerCase()),
          ),
        });
      }),
  );

  return { proposals: outputs.flatMap((output) => output.proposals) };
}
