import type { WorkflowRun } from "@/app/lib/types";

/** True when persisted AI issues exist but were written for a different commit than the snapshot. */
export function isAiScanStaleForRun(run: WorkflowRun): boolean {
  const issues = run.aiScanResult;
  if (!Array.isArray(issues) || issues.length === 0) return false;
  const scanned = run.aiScanScannedCommitSha;
  if (scanned == null || scanned === "") return false;
  return scanned !== run.commitSha;
}
