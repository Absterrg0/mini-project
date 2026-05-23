import type { WorkflowRun } from "@/app/lib/types";

/** Per-test failures from SDK JUnit parsing — used by AI scan and run analysis prompts. */
export function formatCapturedTestFailures(run: WorkflowRun, limit = 20): string {
  const tests = run.runtimeTelemetry?.tests ?? [];
  const failed = tests.filter((t) => t.failed);
  if (!failed.length) {
    return "None (configure JUnit export — e.g. jest-junit or Playwright junit reporter — so finish step ingests failure messages).";
  }
  return failed
    .slice(0, limit)
    .map((t) => {
      const msg = t.failureMessage?.replace(/\s+/g, " ").trim().slice(0, 400);
      return `- ${t.file} :: ${t.name} (${t.durationSec.toFixed(2)}s)${msg ? `\n  message: ${msg}` : ""}`;
    })
    .join("\n");
}
