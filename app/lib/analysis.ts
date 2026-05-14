import type { WorkflowRun } from "@/app/lib/types";
import type { OptimizationAction } from "@/app/lib/types";

// ─── Abnormality detection ─────────────────────────────────────────────────────

export interface Abnormality {
  id: string;
  severity: "warning" | "danger";
  title: string;
  detail: string;
  /** The optimization action id that resolves this, if any */
  actionId?: string;
}

export function detectAbnormalities(runs: WorkflowRun[]): Abnormality[] {
  if (!runs.length) return [];

  const results: Abnormality[] = [];
  const durations = runs.map((r) => r.totalDurationSec);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const failed = runs.filter((r) => r.status === "failed");
  const failureRate = failed.length / runs.length;

  // Failure rate
  if (failureRate >= 0.5) {
    results.push({
      id: "high-failure-rate",
      severity: "danger",
      title: "High failure rate",
      detail: `${Math.round(failureRate * 100)}% of recent runs failed — median CI is broken.`,
      actionId: "flaky-quarantine",
    });
  } else if (failureRate >= 0.2) {
    results.push({
      id: "elevated-failure-rate",
      severity: "warning",
      title: "Elevated failure rate",
      detail: `${Math.round(failureRate * 100)}% of runs failed in this period.`,
      actionId: "flaky-quarantine",
    });
  }

  // Duration regression — last run vs rolling avg
  const sorted = [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const latestRun = sorted[0];
  if (latestRun && avgDuration > 0 && latestRun.totalDurationSec > avgDuration * 1.5) {
    results.push({
      id: "duration-regression",
      severity: "warning",
      title: "Duration regression",
      detail: `Latest run (${Math.round(latestRun.totalDurationSec)}s) is ${Math.round((latestRun.totalDurationSec / avgDuration - 1) * 100)}% slower than average.`,
      actionId: "remote-cache",
    });
  }

  // Increasing duration trend (last 3 vs first 3)
  if (runs.length >= 6) {
    const chrono = [...runs].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const firstAvg = chrono.slice(0, 3).reduce((a, r) => a + r.totalDurationSec, 0) / 3;
    const lastAvg = chrono.slice(-3).reduce((a, r) => a + r.totalDurationSec, 0) / 3;
    if (lastAvg > firstAvg * 1.25) {
      results.push({
        id: "duration-trend-up",
        severity: "warning",
        title: "Duration increasing over time",
        detail: `Avg duration grew ${Math.round((lastAvg / firstAvg - 1) * 100)}% over the observed period.`,
        actionId: "remote-cache",
      });
    }
  }

  // Zero cache hits (enriched data required)
  const enriched = runs.filter((r) => r.telemetrySource === "execforge-wrapper");
  if (enriched.length > 0) {
    const allJobs = enriched.flatMap((r) => r.jobs);
    const avgCache =
      allJobs.length > 0
        ? allJobs.reduce((s, j) => s + j.cacheHitRate, 0) / allJobs.length
        : 0;

    if (avgCache < 0.1 && allJobs.length > 0) {
      results.push({
        id: "zero-cache",
        severity: "warning",
        title: "Near-zero cache hit rate",
        detail: `Cache hit rate is ${Math.round(avgCache * 100)}% — every run reinstalls dependencies from scratch.`,
        actionId: "remote-cache",
      });
    }

    // High CPU on enriched runs
    const allSamples = enriched.flatMap((r) => r.runtimeTelemetry?.samples ?? []);
    if (allSamples.length > 0) {
      const peakCpu = Math.max(...allSamples.map((s) => s.cpuPct));
      if (peakCpu > 90) {
        results.push({
          id: "high-cpu",
          severity: "warning",
          title: "CPU saturation detected",
          detail: `Peak CPU hit ${peakCpu.toFixed(1)}% — runner may be overloaded, causing queuing and flakiness.`,
          actionId: "remote-cache",
        });
      }
    }
  }

  return results;
}

// ─── Real suggestOptimizations ─────────────────────────────────────────────────
// Replaces the partially-hardcoded version in intelligence.ts with one that
// actually analyses the passed run's data.

export function deriveOptimizations(run: WorkflowRun, allRuns: WorkflowRun[]): OptimizationAction[] {
  const actions: OptimizationAction[] = [];

  // Only suggest installing the wrapper if NO run in this repo has enriched telemetry yet.
  // This prevents the false-positive where the wrapper IS installed (some runs are enriched)
  // but the specific run being analyzed came in via the github webhook source before the wrapper ran.
  const anyEnriched = allRuns.some((r) => r.telemetrySource === "execforge-wrapper");
  if (!anyEnriched && run.telemetrySource !== "execforge-wrapper") {
    actions.push({
      id: "install-telemetry-wrapper",
      title: "Install ExecForge runtime telemetry",
      rationale:
        "This run only has webhook-level data (status, duration). Adding the runtime wrapper captures CPU, memory, exit code, and process samples without rebuilding your workflow.",
      estimatedTimeSavingsPct: 0,
      estimatedCostSavingsUsdMonthly: 0,
      risk: "low",
      filesToChange: [".github/workflows/execforge-runtime-example.yml", ".github/execforge/README.md"],
    });
  }

  // Analyse jobs for cache health
  const avgCacheHit =
    run.jobs.length > 0
      ? run.jobs.reduce((s, j) => s + j.cacheHitRate, 0) / run.jobs.length
      : null;

  if (avgCacheHit !== null && avgCacheHit < 0.4) {
    const savingsPct = Math.round(30 * (1 - avgCacheHit / 0.4));
    actions.push({
      id: "remote-cache",
      title: "Enable remote cache hydration for install and build tasks",
      rationale: `Cache hit rate is ${Math.round(avgCacheHit * 100)}% — most jobs reinstall +ependencies from scratch. Adding \`actions/cache@v4\` with a stable key reduces install time by roughly ${savingsPct}%.`,
      estimatedTimeSavingsPct: savingsPct,
      estimatedCostSavingsUsdMonthly: Math.round(savingsPct * 15),
      risk: "low",
      filesToChange: [".github/workflows/ci.yml"],
    });
  }

  // Docker layer detection (job names or step names)
  const allStepNames = run.jobs.flatMap((j) => j.steps.map((s) => s.name.toLowerCase()));
  const hasDocker =
    allStepNames.some((s) => s.includes("docker") || s.includes("build-push") || s.includes("buildx")) ||
    run.jobs.some((j) => j.name.toLowerCase().includes("docker"));
  if (hasDocker) {
    actions.push({
      id: "split-docker-stages",
      title: "Split Dockerfile into dependency and app layers",
      rationale:
        "Docker build steps detected. Splitting into multi-stage builds (deps → build → runner) preserves layer caching across pushes.",
      estimatedTimeSavingsPct: 28,
      estimatedCostSavingsUsdMonthly: Math.round(run.totalDurationSec * 0.4),
      risk: "low",
      filesToChange: ["Dockerfile", ".github/workflows/ci.yml"],
    });
  }

  // E2E detection
  const hasE2E =
    run.jobs.some((j) => j.id === "e2e" || j.name.toLowerCase().includes("e2e") || j.name.toLowerCase().includes("playwright")) ||
    allStepNames.some((s) => s.includes("playwright") || s.includes("cypress"));
  if (hasE2E) {
    actions.push({
      id: "e2e-matrix",
      title: "Shard E2E suite across matrix workers",
      rationale:
        "E2E steps detected. Matrix sharding across 4 workers reduces wall-clock time proportionally without changing test coverage.",
      estimatedTimeSavingsPct: 25,
      estimatedCostSavingsUsdMonthly: Math.round(run.totalDurationSec * 0.3),
      risk: "medium",
      filesToChange: [".github/workflows/e2e.yml", "playwright.config.ts"],
    });
  }

  // Flaky test detection from all runs
  const flakyJobs = run.jobs.filter((j) => j.status === "flaky");
  const allFailed = allRuns.filter((r) => r.status === "failed");
  if (flakyJobs.length > 0 || allFailed.length / Math.max(1, allRuns.length) > 0.15) {
    actions.push({
      id: "flaky-quarantine",
      title: "Quarantine flaky tests and open stabilization issues",
      rationale: `${flakyJobs.length} flaky job(s) detected and ${allFailed.length} failed run(s) in total. Quarantining unstable tests restores green build signal.`,
      estimatedTimeSavingsPct: 12,
      estimatedCostSavingsUsdMonthly: Math.round(allFailed.length * 20),
      risk: "medium",
      filesToChange: ["tests/flaky.allowlist.json", ".github/workflows/ci.yml"],
    });
  }

  // High CPU saturation (enriched only)
  if (run.telemetrySource === "execforge-wrapper") {
    const samples = run.runtimeTelemetry?.samples ?? [];
    const peakCpu = samples.length > 0 ? Math.max(...samples.map((s) => s.cpuPct)) : 0;
    if (peakCpu > 85) {
      actions.push({
        id: "remote-cache",
        title: "Reduce CPU pressure via caching",
        rationale: `Peak CPU was ${peakCpu.toFixed(1)}% during this run. Caching build artifacts and node_modules reduces re-computation and CPU pressure on subsequent runs.`,
        estimatedTimeSavingsPct: 20,
        estimatedCostSavingsUsdMonthly: 200,
        risk: "low",
        filesToChange: [".github/workflows/ci.yml"],
      });
    }
  }

  // Generate tests feature
  const testsMissingOrSparse = run.tests.length < 5;
  if (testsMissingOrSparse) {
    actions.push({
      id: "generate-tests",
      title: "Auto-generate unit tests for untested core files",
      rationale: `Only ${run.tests.length} tests detected in the current run. Adding base unit tests increases reliability and reduces the risk of undetected regressions.`,
      estimatedTimeSavingsPct: 0,
      estimatedCostSavingsUsdMonthly: 0,
      risk: "low",
      filesToChange: ["tests/core.test.ts"],
    });
  }

  // Deduplicate by id (keep first occurrence)
  const seen = new Set<string>();
  return actions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
