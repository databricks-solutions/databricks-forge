import { parseMetricViewYaml } from "./parser";
import { validateIdentifier } from "@/lib/validation";
import { buildMetricViewDdlFromDefinition, serializeMetricViewYaml } from "./serializer";
import type { MetricViewDefinition } from "./definition";
import type { MetricViewProposal } from "./types";
import { replaceMetricViewDdlYaml } from "./ddl-envelope";

export interface MetricViewDeploymentTarget {
  catalog: string;
  schema: string;
}

export type LegacyMetricViewTarget = MetricViewDeploymentTarget | { originalDdl: string };

export function deploymentTargetFromSchemaScope(
  schemaScope: string,
): MetricViewDeploymentTarget | undefined {
  if (schemaScope.includes(",")) return undefined;
  const parts = schemaScope.split(".");
  if (parts.length !== 2) return undefined;
  try {
    return {
      catalog: validateIdentifier(parts[0], "metric view target catalog"),
      schema: validateIdentifier(parts[1], "metric view target schema"),
    };
  } catch {
    return undefined;
  }
}

export function proposalToDefinition(
  proposal: Pick<MetricViewProposal, "yaml" | "name">,
): MetricViewDefinition | null {
  try {
    return parseMetricViewYaml(proposal.yaml, proposal.name);
  } catch {
    return null;
  }
}

export function definitionToLegacyText(
  definition: MetricViewDefinition,
  target: LegacyMetricViewTarget,
): { yaml: string; ddl: string } {
  if (!target) {
    throw new Error("An explicit metric view deployment target is required.");
  }

  const yaml = serializeMetricViewYaml(definition);
  if ("originalDdl" in target) {
    return {
      yaml,
      ddl: replaceMetricViewDdlYaml(target.originalDdl, yaml),
    };
  }

  const deploymentTarget = deploymentTargetFromSchemaScope(`${target.catalog}.${target.schema}`);
  if (!deploymentTarget) {
    throw new Error("An explicit metric view deployment target must be catalog.schema.");
  }
  return {
    yaml,
    ddl: buildMetricViewDdlFromDefinition({ ...deploymentTarget, definition }),
  };
}

export function ensureMetricViewDefinition(
  proposal: MetricViewProposal,
): MetricViewProposal & { definition?: MetricViewDefinition } {
  if (proposal.definition) return proposal;

  const definition = proposalToDefinition(proposal);
  return definition ? { ...proposal, definition } : proposal;
}
