import { z } from "zod";

export const MAX_ESTATE_NAME_LENGTH = 200;
export const MAX_ESTATE_DESCRIPTION_LENGTH = 2_000;
export const MAX_ESTATE_INDUSTRY_ID_LENGTH = 100;
export const MAX_SUB_VERTICAL_LENGTH = 120;
export const MAX_ORG_CONTEXT_LENGTH = 2_000;

const trimmedRequiredName = z
  .string()
  .trim()
  .min(1, "Program name is required")
  .max(
    MAX_ESTATE_NAME_LENGTH,
    `Program name must be ${MAX_ESTATE_NAME_LENGTH} characters or fewer`,
  );

const trimmedDescription = z
  .string()
  .trim()
  .max(
    MAX_ESTATE_DESCRIPTION_LENGTH,
    `Description must be ${MAX_ESTATE_DESCRIPTION_LENGTH} characters or fewer`,
  );

const optionalBoundedString = (label: string, max: number) =>
  z
    .union([z.string().trim().max(max, `${label} must be ${max} characters or fewer`), z.null()])
    .transform((value) => (typeof value === "string" ? value || null : null));

const industryId = optionalBoundedString("Industry ID", MAX_ESTATE_INDUSTRY_ID_LENGTH);
const subVertical = optionalBoundedString("Sub-vertical", MAX_SUB_VERTICAL_LENGTH);
const orgContext = optionalBoundedString("Organisation context", MAX_ORG_CONTEXT_LENGTH);

/** Shared bounded create schema used by both the API and UI payload builder. */
export const EstateProgramCreateSchema = z.object({
  name: trimmedRequiredName,
  description: trimmedDescription.default(""),
  industryId: industryId.default(null),
  subVertical: subVertical.default(null),
  orgContext: orgContext.default(null),
});

/** Shared bounded patch schema. Omitted fields remain omitted; explicit null clears optional fields. */
export const EstateProgramPatchSchema = z.object({
  name: trimmedRequiredName.optional(),
  description: z.union([trimmedDescription, z.null()]).optional(),
  industryId: industryId.optional(),
  subVertical: subVertical.optional(),
  orgContext: orgContext.optional(),
});

export type EstateProgramCreateInput = z.infer<typeof EstateProgramCreateSchema>;
export type EstateProgramPatchInput = z.infer<typeof EstateProgramPatchSchema>;

type NormalizeOptions = {
  mode: "create" | "patch";
  /** Registry lookup supplied by server routes; omitted by the client form. */
  isRegisteredIndustry?: (industryId: string) => boolean;
};

export type NormalizeEstateProgramResult =
  | {
      success: true;
      data: EstateProgramCreateInput | EstateProgramPatchInput;
    }
  | { success: false; error: string };

/**
 * One normalization boundary for POST, PATCH, and the create form. It applies
 * identical trimming/length rules, while server routes additionally supply
 * the registered-industry lookup.
 */
export function normalizeEstateProgramInput(
  raw: unknown,
  options: NormalizeOptions,
): NormalizeEstateProgramResult {
  const parsed =
    options.mode === "create"
      ? EstateProgramCreateSchema.safeParse(raw)
      : EstateProgramPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid program input" };
  }

  const normalizedIndustry = parsed.data.industryId;
  if (
    normalizedIndustry &&
    options.isRegisteredIndustry &&
    !options.isRegisteredIndustry(normalizedIndustry)
  ) {
    return { success: false, error: `Unknown industryId "${normalizedIndustry}"` };
  }

  return { success: true, data: parsed.data };
}
