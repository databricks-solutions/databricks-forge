export interface GenieSmokeTestSummary {
  passed: number;
  clarifications: number;
  failed: number;
  total: number;
}

export interface GenieSmokeTestNotification {
  tone: "success" | "warning" | "info" | "error";
  message: string;
}

function outcomeDetails(summary: GenieSmokeTestSummary): string {
  const details: string[] = [];
  if (summary.clarifications > 0) {
    details.push(
      `${summary.clarifications} clarification${summary.clarifications === 1 ? "" : "s"}`,
    );
  }
  if (summary.failed > 0) details.push(`${summary.failed} failed`);
  return details.length > 0 ? `; ${details.join("; ")}` : "";
}

export function classifyGenieSmokeTestSummary(
  summary: GenieSmokeTestSummary,
): GenieSmokeTestNotification {
  const passCount = `${summary.passed}/${summary.total} SQL checks passed`;
  const details = outcomeDetails(summary);

  if (summary.total > 0 && summary.passed === summary.total) {
    return { tone: "success", message: `Test complete: ${passCount}` };
  }
  if (summary.total > 0 && summary.failed === summary.total) {
    return { tone: "error", message: `Test failed: ${passCount}${details}` };
  }
  if (summary.total > 0 && summary.clarifications === summary.total) {
    return { tone: "info", message: `Test complete: ${passCount}${details}` };
  }
  return {
    tone: summary.total > 0 ? "warning" : "error",
    message:
      summary.total > 0
        ? `Test complete: ${passCount}${details}`
        : "Test failed: no results returned",
  };
}
