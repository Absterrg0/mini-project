import type { WorkflowRun } from "@/app/lib/types";
import type { ExistingPlan } from "@/lib/execution-store";

/**
 * AI scan rows are stored per workflow run (`AiScanResult.runExternalId` ↔ `WorkflowRun.id`).
 * Only issues from **that** run’s persisted scan are shown — never from an older run/commit
 * without a scan for the viewed run (avoids stale carry-over).
 */

export function resolveEffectiveAiScanIssues(run: WorkflowRun): { issues: unknown[] } {
  const own = run.aiScanResult;
  if (Array.isArray(own)) {
    return { issues: own };
  }
  return { issues: [] };
}

/** Merge persisted plans when combining results from two run ids (e.g. client carry-forward fetch). */
export function mergeExistingPlansByAction(prior: ExistingPlan[], latest: ExistingPlan[]): ExistingPlan[] {
  const map = new Map<string, ExistingPlan>();
  for (const p of prior) {
    map.set(p.actionId, p);
  }
  for (const p of latest) {
    const cur = map.get(p.actionId);
    if (!cur || new Date(p.createdAt) > new Date(cur.createdAt)) {
      map.set(p.actionId, p);
    }
  }
  return Array.from(map.values());
}
