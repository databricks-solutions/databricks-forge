/**
 * Database representation for a logically-null lineage entity type.
 *
 * PostgreSQL UNIQUE indexes treat NULL values as distinct, so persisting a
 * real NULL would let repeated createMany({ skipDuplicates: true }) calls
 * accumulate the same logical edge. Store one non-null sentinel instead and
 * translate only at persistence/presentation boundaries.
 */
export const LINEAGE_NULL_ENTITY_TYPE = "__forge_null_entity__";

export function toStoredLineageEntityType(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : LINEAGE_NULL_ENTITY_TYPE;
}

export function fromStoredLineageEntityType(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized === LINEAGE_NULL_ENTITY_TYPE) return null;
  return normalized;
}

export function fromStoredLineageEdge<T extends { entityType?: string | null }>(
  edge: T,
): Omit<T, "entityType"> & { entityType: string | null } {
  return {
    ...edge,
    entityType: fromStoredLineageEntityType(edge.entityType),
  };
}
