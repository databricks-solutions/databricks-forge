/**
 * Maps Microsoft Information Protection (MIP) sensitivity labels
 * to Unity Catalog table tags during Gold table deployment.
 *
 * The Admin Scanner API returns sensitivity labels as GUIDs (labelId).
 * Since these are tenant-specific, the mapping must be user-configurable.
 * Default mappings cover common MIP label display names; users can
 * supply custom mappings keyed by their actual labelId GUIDs.
 */

export interface SensitivityLabelMapping {
  labelId: string;
  labelName: string;
  ucTagKey: string;
  ucTagValue: string;
}

const DEFAULT_MAPPINGS: SensitivityLabelMapping[] = [
  { labelId: "", labelName: "Public", ucTagKey: "sensitivity", ucTagValue: "public" },
  { labelId: "", labelName: "General", ucTagKey: "sensitivity", ucTagValue: "general" },
  { labelId: "", labelName: "Confidential", ucTagKey: "sensitivity", ucTagValue: "confidential" },
  {
    labelId: "",
    labelName: "Highly Confidential",
    ucTagKey: "sensitivity",
    ucTagValue: "highly_confidential",
  },
];

/**
 * Resolves a PBI sensitivity label ID to a UC tag key/value pair.
 *
 * Lookup order:
 * 1. Custom mappings (exact labelId match)
 * 2. Default mappings (exact labelId match -- only useful if user
 *    has pre-configured them with their tenant-specific GUIDs)
 *
 * Returns null if no mapping is found.
 */
export function resolveLabelTag(
  labelId: string | null,
  customMappings?: SensitivityLabelMapping[],
): { key: string; value: string } | null {
  if (!labelId) return null;

  const allMappings = [...(customMappings ?? []), ...DEFAULT_MAPPINGS];
  const match = allMappings.find((m) => m.labelId === labelId);
  if (match) return { key: match.ucTagKey, value: match.ucTagValue };

  return null;
}

/**
 * Generates ALTER TABLE ... SET TAGS DDL for a sensitivity label mapping.
 */
export function buildTagDdl(fqn: string, tag: { key: string; value: string }): string {
  return `ALTER TABLE ${fqn} SET TAGS ('${tag.key}' = '${tag.value}');`;
}

/**
 * Returns the default label mappings so the UI can display them.
 */
export function getDefaultMappings(): SensitivityLabelMapping[] {
  return DEFAULT_MAPPINGS;
}
