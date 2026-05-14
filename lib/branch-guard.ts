/**
 * Branch-level guards for ExecForge-owned branches.
 *
 * When ExecForge creates optimization PRs, GitHub Actions runs CI on them.
 * Without this guard those CI runs get re-ingested, causing:
 *   1. Duplicate entries (one "standard" from the webhook, one "enriched" from the wrapper)
 *   2. Circular metric pollution (the run shows up in the PR Agent as a target to "fix")
 *   3. False positives — e.g. "Install ExecForge telemetry" suggested on our own PRs
 *
 * All branches created by ExecForge's PR Agent follow the pattern: `exec-intel/*`
 * Match this at every ingestion boundary so nothing leaks into the DB.
 */

/** Prefix used for all branches ExecForge creates via the PR Agent. */
export const EXEC_INTEL_BRANCH_PREFIX = "exec-intel/";

/**
 * Returns true if the branch was created by ExecForge's PR Agent and
 * should therefore be excluded from ingestion and dashboard metrics.
 */
export function isExecForgeOwnedBranch(branch: string): boolean {
  if (!branch) return false;
  return branch.startsWith(EXEC_INTEL_BRANCH_PREFIX);
}

/**
 * Filter a list of workflow runs to exclude any from ExecForge-owned branches.
 * Use this as a safety net in the snapshot / display layer for runs that were
 * ingested before this guard was in place.
 */
export function filterExecForgeRuns<T extends { branch: string }>(runs: T[]): T[] {
  return runs.filter((r) => !isExecForgeOwnedBranch(r.branch));
}
