/** Context supplied transiently to estate LLM passes; never persisted on scans. */
export interface EstatePromptContext {
  industryId?: string;
  subVertical?: string;
  orgContext?: string;
}

/**
 * Render one compact, labelled estate-context block for prompt builders.
 * Empty values are omitted so ad-hoc scans retain their current prompts.
 */
export function buildEstateContextBlock(context: EstatePromptContext): string {
  const lines: string[] = [];
  if (context.industryId?.trim()) lines.push(`Industry: ${context.industryId.trim()}`);
  if (context.subVertical?.trim()) lines.push(`Sub-vertical: ${context.subVertical.trim()}`);
  if (context.orgContext?.trim()) {
    // Bound legacy/programmatic values too; current create UI/API already cap
    // this field, but prompt builders must remain safe for pre-existing rows.
    lines.push(`Organisation context: ${context.orgContext.trim().slice(0, 2_000)}`);
  }
  return lines.length > 0
    ? `## Estate context\n${lines.map((line) => `- ${line}`).join("\n")}`
    : "";
}
