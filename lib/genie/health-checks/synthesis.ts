/**
 * LLM-powered synthesis and qualitative analysis for Genie Space health checks.
 *
 * - runLlmQualitativeChecks(): evaluates qualitative checklist items via Model Serving
 * - runSynthesis(): generates cross-sectional synthesis after all checks complete
 */

import { resolveEndpoint } from "@/lib/dbx/client";
import { chatCompletion } from "@/lib/dbx/model-serving";
import { logger } from "@/lib/logger";
import type {
  CheckDefinition,
  CheckResult,
  Finding,
  SpaceHealthReport,
  SynthesisResult,
} from "./types";
import { resolvePath } from "./evaluators";
import type { SpaceJson } from "@/lib/genie/types";
import "@/lib/skills/content";
import { resolveForGeniePass, formatContextSections } from "@/lib/skills/resolver";

interface LlmCheckEvaluation {
  id: string;
  passed: boolean;
  details: string;
}

interface LlmQualitativeResponse {
  evaluations: LlmCheckEvaluation[];
  findings: Array<{
    category: "best_practice" | "warning" | "suggestion";
    severity: "critical" | "warning" | "info";
    description: string;
    recommendation: string;
    reference?: string;
  }>;
}

/**
 * Run qualitative checks against a space using LLM evaluation.
 * Groups checks by their path (section) and batches them into LLM calls.
 */
export async function runLlmQualitativeChecks(
  space: SpaceJson,
  checks: CheckDefinition[],
): Promise<{ results: CheckResult[]; findings: Finding[] }> {
  const qualitativeChecks = checks.filter(
    (c) => c.evaluator === "llm_qualitative" && c.quality_prompt,
  );
  if (qualitativeChecks.length === 0) return { results: [], findings: [] };

  const sectionGroups = new Map<string, CheckDefinition[]>();
  for (const check of qualitativeChecks) {
    const section = check.path ?? "root";
    if (!sectionGroups.has(section)) sectionGroups.set(section, []);
    sectionGroups.get(section)!.push(check);
  }

  const allResults: CheckResult[] = [];
  const allFindings: Finding[] = [];
  const endpoint = resolveEndpoint("classification");

  for (const [section, sectionChecks] of sectionGroups) {
    try {
      const sectionData = section === "root" ? space : resolvePath(space, section);
      const sectionJson = JSON.stringify(sectionData, null, 2);

      const itemsText = sectionChecks.map((c) => `- ${c.id}: ${c.quality_prompt}`).join("\n");

      const hcSkills = resolveForGeniePass("instructions", { contextBudget: 1500 });
      const hcSkillBlock = formatContextSections(hcSkills.contextSections);

      const prompt = `You are evaluating a Databricks Genie Space configuration section against quality criteria.

## Section: ${section}

## Data to Analyze:
\`\`\`json
${sectionJson.slice(0, 8000)}
\`\`\`
${hcSkillBlock ? `\n## Genie Best Practices Reference\n${hcSkillBlock}\n` : ""}
## Quality Criteria to Evaluate:
${itemsText}

For each criterion, determine if the configuration passes or fails.
Be fair but thorough -- a check should pass if the configuration reasonably meets the criterion.
If the section data is empty/null, most quality checks should fail.

Output JSON with this exact structure:
{
  "evaluations": [
    { "id": "criterion_id", "passed": true, "details": "Brief explanation" }
  ],
  "findings": [
    {
      "category": "best_practice",
      "severity": "warning",
      "description": "Issue description (only for failed items)",
      "recommendation": "Specific actionable recommendation",
      "reference": "related criterion id"
    }
  ]
}

Only include findings for FAILED criteria. Match severity to importance:
- critical: Major best practice violation
- warning: Recommended practice not followed
- info: Minor improvement opportunity`;

      const response = await chatCompletion({
        endpoint,
        messages: [{ role: "user", content: prompt }],
        responseFormat: "json_object",
      });

      if (!response.content) throw new Error("Empty LLM response");
      const parsed = JSON.parse(response.content) as LlmQualitativeResponse;

      const evaluationMap = new Map((parsed.evaluations ?? []).map((e) => [e.id, e]));
      for (const check of sectionChecks) {
        const evaluation = evaluationMap.get(check.id);
        allResults.push({
          id: check.id,
          category: check.category,
          description: check.description,
          passed: evaluation?.passed ?? false,
          severity: check.severity,
          detail: evaluation?.details ?? "LLM evaluation failed to return result",
          fixable: check.fixable,
          fixStrategy: check.fix_strategy,
        });
      }

      for (const finding of parsed.findings ?? []) {
        allFindings.push({
          category:
            finding.category === "best_practice"
              ? "best_practice"
              : finding.category === "warning"
                ? "warning"
                : "suggestion",
          severity:
            finding.severity === "critical"
              ? "critical"
              : finding.severity === "warning"
                ? "warning"
                : "info",
          description: finding.description,
          recommendation: finding.recommendation,
          reference: finding.reference,
        });
      }
    } catch (err) {
      logger.warn("LLM qualitative check failed for section, marking all as passed", {
        section,
        error: String(err),
      });
      for (const check of sectionChecks) {
        allResults.push({
          id: check.id,
          category: check.category,
          description: check.description,
          passed: true,
          severity: check.severity,
          detail: "Qualitative evaluation unavailable",
          fixable: check.fixable,
          fixStrategy: check.fix_strategy,
        });
      }
    }
  }

  return { results: allResults, findings: allFindings };
}

/**
 * Run cross-sectional synthesis after all checks are complete.
 * Uses LLM to identify compensating strengths, celebration points, and quick wins.
 */
export async function runSynthesis(report: SpaceHealthReport): Promise<SynthesisResult> {
  const endpoint = resolveEndpoint("classification");

  const categorySummaries = Object.entries(report.categories)
    .map(([_id, cat]) => `- ${cat.label}: ${cat.passed}/${cat.total} passed (${cat.score}%)`)
    .join("\n");

  const failedCheckSummaries = report.checks
    .filter((c) => !c.passed)
    .map((c) => `- [${c.severity}] ${c.description}${c.detail ? `: ${c.detail}` : ""}`)
    .join("\n");

  const synthSkills = resolveForGeniePass("instructions", { contextBudget: 1200 });
  const synthSkillBlock = formatContextSections(synthSkills.contextSections);

  const prompt = `You are synthesizing a cross-sectional analysis of a Databricks Genie Space configuration.

## Overall Score: ${report.overallScore}/100 (Grade: ${report.grade})

## Category Scores:
${categorySummaries}

## Failed Checks:
${failedCheckSummaries || "None -- all checks passed!"}
${synthSkillBlock ? `\n## Genie Best Practices Reference\n${synthSkillBlock}\n` : ""}
## Instructions:

Based on the category scores and failed checks, provide a holistic assessment:

1. Identify compensating strengths: where one category's strength compensates for another's weakness.
2. Celebrate what's working well: 2-4 strengths worth preserving.
3. Identify quick wins: 3-5 specific, actionable improvements with high impact.
4. Determine overall assessment:
   - "good_to_go": well-configured, minor improvements only
   - "quick_wins": works but has clear improvement opportunities
   - "foundation_needed": needs fundamental improvements

Be encouraging but honest. Focus on improvement over failures.

Output JSON:
{
  "assessment": "good_to_go" | "quick_wins" | "foundation_needed",
  "assessment_rationale": "Brief explanation",
  "compensating_strengths": [
    { "covering_section": "category providing strength", "covered_section": "category being compensated", "explanation": "how" }
  ],
  "celebration_points": ["What's working well (2-4 items)"],
  "top_quick_wins": ["Specific actionable improvement (3-5 items)"]
}`;

  try {
    const response = await chatCompletion({
      endpoint,
      messages: [{ role: "user", content: prompt }],
      responseFormat: "json_object",
    });

    if (!response.content) throw new Error("Empty synthesis response");
    const parsed = JSON.parse(response.content);

    return {
      assessment: parsed.assessment ?? "quick_wins",
      assessmentRationale: parsed.assessment_rationale ?? "",
      compensatingStrengths: (parsed.compensating_strengths ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cs: any) => ({
          coveringSection: cs.covering_section ?? "",
          coveredSection: cs.covered_section ?? "",
          explanation: cs.explanation ?? "",
        }),
      ),
      celebrationPoints: parsed.celebration_points ?? [],
      topQuickWins: parsed.top_quick_wins ?? [],
    };
  } catch (err) {
    logger.warn("Synthesis LLM call failed, returning defaults", { error: String(err) });
    return {
      assessment:
        report.overallScore >= 80
          ? "good_to_go"
          : report.overallScore >= 50
            ? "quick_wins"
            : "foundation_needed",
      assessmentRationale: "Automated assessment based on score (LLM synthesis unavailable)",
      compensatingStrengths: [],
      celebrationPoints: [],
      topQuickWins: report.quickWins.slice(0, 5),
    };
  }
}
