import { IdentifierValidationError, validateFqn } from "@/lib/validation";

export function validateMetricViewTargetSchema(targetSchema: string): string {
  const validated = validateFqn(targetSchema, "metric view target schema");
  if (validated.split(".").length !== 2) {
    throw new IdentifierValidationError("metric view target schema must be exactly catalog.schema");
  }
  return validated;
}
