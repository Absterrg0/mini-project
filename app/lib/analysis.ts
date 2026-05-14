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

interface RuleEngineSignals {
  avgCacheHit: number | null;
  failureRate: number;
  failedRuns: number;
  runFrequencyMonthly: number;
  criticalPathSec: number;
  slowestJobSec: number;
  avgDurationSec: number;
  p95DurationSec: number;
  slowestSteps: Array<{ job: string; step: string; durationSec: number }>;
  installStepSec: number;
  testStepSec: number;
  buildStepSec: number;
  artifactStepSec: number;
  e2eStepSec: number;
  dockerStepSec: number;
  peakCpu: number;
  avgCpu: number;
  peakMemoryMb: number;
  cpuCount: number;
  totalMemoryMb: number;
  testFailureCostSec: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[index];
}

function stepBucketSeconds(run: WorkflowRun, patterns: RegExp[]) {
  return run.jobs
    .flatMap((job) => job.steps)
    .filter((step) => patterns.some((pattern) => pattern.test(step.name.toLowerCase())))
    .reduce((sum, step) => sum + step.durationSec, 0);
}

function buildSignals(run: WorkflowRun, allRuns: WorkflowRun[]): RuleEngineSignals {
  const repoRuns = allRuns.length ? allRuns : [run];
  const durations = repoRuns.map((r) => r.totalDurationSec).filter((duration) => duration > 0);
  const firstStartedAt = Math.min(...repoRuns.map((r) => new Date(r.startedAt).getTime()));
  const lastStartedAt = Math.max(...repoRuns.map((r) => new Date(r.startedAt).getTime()));
  const observedDays = Math.max(1, (lastStartedAt - firstStartedAt) / 86_400_000);
  const monthlyRunMultiplier = clamp(30 / observedDays, 1, 30);
  const runFrequencyMonthly = Math.max(repoRuns.length, Math.round(repoRuns.length * monthlyRunMultiplier));
  const allSamples = run.runtimeTelemetry?.samples ?? [];
  const memoryValues = allSamples.map((sample) => sample.memoryRssMb).filter((value) => value > 0);
  const cpuValues = allSamples.map((sample) => sample.cpuPct).filter((value) => value > 0);
  const allSteps = run.jobs.flatMap((job) =>
    job.steps.map((step) => ({ job: job.name, step: step.name, durationSec: step.durationSec })),
  );

  return {
    avgCacheHit:
      run.jobs.length > 0 ? run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) / run.jobs.length : null,
    failureRate: repoRuns.filter((r) => r.status === "failed").length / Math.max(1, repoRuns.length),
    failedRuns: repoRuns.filter((r) => r.status === "failed").length,
    runFrequencyMonthly,
    criticalPathSec: Math.max(run.totalDurationSec, ...run.jobs.map((job) => job.durationSec), 0),
    slowestJobSec: Math.max(...run.jobs.map((job) => job.durationSec), 0),
    avgDurationSec: durations.reduce((sum, duration) => sum + duration, 0) / Math.max(1, durations.length),
    p95DurationSec: percentile(durations, 95),
    slowestSteps: allSteps.sort((a, b) => b.durationSec - a.durationSec).slice(0, 5),
    installStepSec: stepBucketSeconds(run, [/npm ci/, /npm install/, /pnpm install/, /yarn install/, /install depend/]),
    testStepSec: stepBucketSeconds(run, [/test/, /vitest/, /jest/]),
    buildStepSec: stepBucketSeconds(run, [/build/, /compile/, /next build/, /turbo/]),
    artifactStepSec: stepBucketSeconds(run, [/upload-artifact/, /download-artifact/, /artifact/]),
    e2eStepSec: stepBucketSeconds(run, [/e2e/, /playwright/, /cypress/]),
    dockerStepSec: stepBucketSeconds(run, [/docker/, /buildx/, /build-push/]),
    peakCpu: cpuValues.length ? Math.max(...cpuValues) : 0,
    avgCpu: cpuValues.length ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length : 0,
    peakMemoryMb: memoryValues.length ? Math.max(...memoryValues) : 0,
    cpuCount: run.runtimeTelemetry?.machine?.cpuCount ?? 2,
    totalMemoryMb: run.runtimeTelemetry?.machine?.totalMemoryMb ?? 7_000,
    testFailureCostSec: repoRuns
      .filter((r) => r.status === "failed")
      .reduce((sum, failedRun) => sum + failedRun.totalDurationSec, 0),
  };
}

function estimateMonthlyCostSavings(run: WorkflowRun, signals: RuleEngineSignals, savingsPct: number) {
  const githubHostedLinuxCostPerMinute = 0.008;
  const developerHourlyCostUsd = 85;
  const developerAttentionFactor = clamp(0.35 + signals.failureRate, 0.35, 1.25);
  const monthlySavedMinutes = (run.totalDurationSec * (savingsPct / 100) * signals.runFrequencyMonthly) / 60;
  const rerunSavedMinutes = (signals.testFailureCostSec * (0.25 + signals.failureRate)) / 60;
  const runnerSavings = (monthlySavedMinutes + rerunSavedMinutes) * githubHostedLinuxCostPerMinute;
  const developerWaitSavings = monthlySavedMinutes * developerAttentionFactor * (developerHourlyCostUsd / 60);
  const failedRunRecoverySavings =
    signals.failedRuns * clamp(run.totalDurationSec / 600, 0.25, 2.5) * (developerHourlyCostUsd / 4);
  const confidenceFloor = Math.max(12, savingsPct * 2 + Math.min(signals.runFrequencyMonthly, 80) * 0.4);

  return Math.round(Math.max(confidenceFloor, runnerSavings + developerWaitSavings + failedRunRecoverySavings));
}

function actionWithEstimate(
  action: Omit<OptimizationAction, "estimatedTimeSavingsPct" | "estimatedCostSavingsUsdMonthly">,
  run: WorkflowRun,
  signals: RuleEngineSignals,
  estimatedTimeSavingsPct: number,
) {
  const roundedSavings = clamp(Math.round(estimatedTimeSavingsPct), 1, 65);
  return {
    ...action,
    estimatedTimeSavingsPct: roundedSavings,
    estimatedCostSavingsUsdMonthly: estimateMonthlyCostSavings(run, signals, roundedSavings),
  } satisfies OptimizationAction;
}

export function deriveOptimizations(run: WorkflowRun, allRuns: WorkflowRun[]): OptimizationAction[] {
  const actions: OptimizationAction[] = [];
  const signals = buildSignals(run, allRuns);
  const allStepNames = run.jobs.flatMap((j) => j.steps.map((s) => s.name.toLowerCase()));
  const topStep = signals.slowestSteps[0];

  // Only suggest installing the wrapper if NO run in this repo has enriched telemetry yet.
  // This prevents the false-positive where the wrapper IS installed (some runs are enriched)
  // but the specific run being analyzed came in via the github webhook source before the wrapper ran.
  const anyEnriched = allRuns.some((r) => r.telemetrySource === "execforge-wrapper");
  if (!anyEnriched && run.telemetrySource !== "execforge-wrapper") {
    actions.push(actionWithEstimate({
        id: "install-telemetry-wrapper",
        title: "Install ExecForge runtime telemetry",
        rationale:
          `This run only has webhook-level data. Runtime samples unlock CPU, memory, exit code, artifact, and step-level bottleneck detection; based on ${signals.runFrequencyMonthly} estimated monthly runs, earlier diagnosis should cut wasted CI loops.`,
        risk: "low",
        filesToChange: [".github/workflows/execforge-runtime-example.yml", ".github/execforge/README.md"],
      },
      run,
      signals,
      signals.failureRate > 0 ? 8 : 4,
    ));
  }

  // Analyse jobs for cache health
  if (signals.avgCacheHit !== null && signals.avgCacheHit < 0.55) {
    const installWeight = signals.installStepSec / Math.max(1, run.totalDurationSec);
    const buildWeight = signals.buildStepSec / Math.max(1, run.totalDurationSec);
    const savingsPct = clamp((1 - signals.avgCacheHit) * 22 + installWeight * 18 + buildWeight * 10, 8, 42);
    actions.push(actionWithEstimate({
        id: "remote-cache",
        title: "Enable remote cache hydration for install and build tasks",
        rationale: `Cache hit rate is ${Math.round(signals.avgCacheHit * 100)}%; install/build steps account for ${Math.round((installWeight + buildWeight) * 100)}% of this run. Adding stable restore keys and build cache hydration targets the slowest repeatable work.`,
        risk: "low",
        filesToChange: [".github/workflows/ci.yml", "turbo.json"],
      },
      run,
      signals,
      savingsPct,
    ));
  }

  if (signals.installStepSec > Math.max(45, run.totalDurationSec * 0.18)) {
    const savingsPct = clamp((signals.installStepSec / Math.max(1, run.totalDurationSec)) * 35, 7, 24);
    actions.push(actionWithEstimate({
        id: "remote-cache",
        title: "Cache dependency installs with lockfile restore keys",
        rationale: `Dependency installation consumed ${Math.round(signals.installStepSec)}s. Lockfile-scoped package manager caches should remove repeated network and extraction work on most runs.`,
        risk: "low",
        filesToChange: [".github/workflows/ci.yml"],
      },
      run,
      signals,
      savingsPct,
    ));
  }

  // Docker layer detection (job names or step names)
  const hasDocker =
    allStepNames.some((s) => s.includes("docker") || s.includes("build-push") || s.includes("buildx")) ||
    run.jobs.some((j) => j.name.toLowerCase().includes("docker"));
  if (hasDocker) {
    const dockerWeight = Math.max(signals.dockerStepSec, signals.buildStepSec) / Math.max(1, run.totalDurationSec);
    actions.push(actionWithEstimate({
        id: "split-docker-stages",
        title: "Split Dockerfile into dependency and app layers",
        rationale: `Docker/build work represents about ${Math.round(dockerWeight * 100)}% of this run. Multi-stage layers plus BuildKit GHA cache preserve dependency and build layers across pushes.`,
        risk: "low",
        filesToChange: ["Dockerfile", ".github/workflows/ci.yml"],
      },
      run,
      signals,
      clamp(18 + dockerWeight * 24, 18, 45),
    ));
  }

  // E2E detection
  const hasE2E =
    run.jobs.some((j) => j.id === "e2e" || j.name.toLowerCase().includes("e2e") || j.name.toLowerCase().includes("playwright")) ||
    allStepNames.some((s) => s.includes("playwright") || s.includes("cypress"));
  if (hasE2E) {
    const e2eWeight = Math.max(signals.e2eStepSec, signals.testStepSec) / Math.max(1, run.totalDurationSec);
    actions.push(actionWithEstimate({
        id: "e2e-matrix",
        title: "Shard E2E suite across matrix workers",
        rationale: `E2E/test execution accounts for roughly ${Math.round(e2eWeight * 100)}% of this run. Four-way matrix sharding lowers wall-clock time while keeping the same suite coverage.`,
        risk: "medium",
        filesToChange: [".github/workflows/e2e.yml", "playwright.config.ts"],
      },
      run,
      signals,
      clamp(e2eWeight * 55, 18, 45),
    ));
  }

  // Flaky test detection from all runs
  const flakyJobs = run.jobs.filter((j) => j.status === "flaky");
  const allFailed = allRuns.filter((r) => r.status === "failed");
  if (flakyJobs.length > 0 || allFailed.length / Math.max(1, allRuns.length) > 0.15) {
    actions.push(actionWithEstimate({
        id: "flaky-quarantine",
        title: "Quarantine flaky tests and open stabilization issues",
        rationale: `${flakyJobs.length} flaky job(s), ${allFailed.length} failed run(s), and a ${Math.round(signals.failureRate * 100)}% recent failure rate are wasting rerun time. Time-boxed quarantine restores signal while stabilization work is tracked.`,
        risk: "medium",
        filesToChange: ["tests/flaky.allowlist.json", ".github/workflows/ci.yml"],
      },
      run,
      signals,
      clamp(8 + signals.failureRate * 30, 10, 32),
    ));
  }

  // High CPU saturation (enriched only)
  if (run.telemetrySource === "execforge-wrapper") {
    if (signals.peakCpu > 85 && signals.avgCpu > 55) {
      actions.push(actionWithEstimate({
          id: "remote-cache",
          title: "Reduce CPU pressure via caching",
          rationale: `CPU peaked at ${signals.peakCpu.toFixed(1)}% with ${signals.avgCpu.toFixed(1)}% average utilization. Caching build artifacts and dependency outputs removes repeated CPU-bound work on later runs.`,
          risk: "low",
          filesToChange: [".github/workflows/ci.yml", "turbo.json"],
        },
        run,
        signals,
        clamp(12 + (signals.peakCpu - 85) * 0.7, 12, 28),
      ));
    }

    const memoryPressure = signals.totalMemoryMb > 0 ? signals.peakMemoryMb / signals.totalMemoryMb : 0;
    if (memoryPressure > 0.82) {
      actions.push(actionWithEstimate({
          id: "remote-cache",
          title: "Lower memory pressure by reusing build outputs",
          rationale: `Peak memory reached ${Math.round(signals.peakMemoryMb)}MB (${Math.round(memoryPressure * 100)}% of runner memory). Reusing compiled outputs reduces repeated high-memory build phases.`,
          risk: "low",
          filesToChange: [".github/workflows/ci.yml", "turbo.json"],
        },
        run,
        signals,
        clamp(9 + memoryPressure * 12, 10, 24),
      ));
    }
  }

  if (run.jobs.length === 1 && run.jobs[0].durationSec > 180 && signals.slowestSteps.length >= 3) {
    const parallelizableWeight =
      signals.slowestSteps.slice(0, 3).reduce((sum, step) => sum + step.durationSec, 0) / Math.max(1, run.totalDurationSec);
    actions.push(actionWithEstimate({
        id: "split-workflow-jobs",
        title: "Split monolithic CI into parallel lint, test, and build jobs",
        rationale: `A single job owns the full ${Math.round(run.jobs[0].durationSec)}s critical path. The top three steps consume ${Math.round(parallelizableWeight * 100)}% of runtime and can run as separate dependent jobs.`,
        risk: "medium",
        filesToChange: [".github/workflows/ci.yml"],
      },
      run,
      signals,
      clamp(parallelizableWeight * 24, 8, 30),
    ));
  }

  if (signals.artifactStepSec > Math.max(60, run.totalDurationSec * 0.12)) {
    actions.push(actionWithEstimate({
        id: "optimize-artifacts",
        title: "Trim CI artifact upload scope and retention",
        rationale: `Artifact transfer steps consumed ${Math.round(signals.artifactStepSec)}s. Narrowing paths and retention reduces upload/download time on every run.`,
        risk: "low",
        filesToChange: [".github/workflows/ci.yml"],
      },
      run,
      signals,
      clamp((signals.artifactStepSec / Math.max(1, run.totalDurationSec)) * 28, 5, 18),
    ));
  }

  if (topStep && topStep.durationSec > Math.max(90, run.totalDurationSec * 0.3)) {
    actions.push(actionWithEstimate({
        id: "remote-cache",
        title: "Target the dominant slow CI step with cache reuse",
        rationale: `"${topStep.step}" in ${topStep.job} took ${Math.round(topStep.durationSec)}s, making it the largest bottleneck. Cache restore keys should focus on this step's inputs and generated outputs first.`,
        risk: "low",
        filesToChange: [".github/workflows/ci.yml", "turbo.json"],
      },
      run,
      signals,
      clamp((topStep.durationSec / Math.max(1, run.totalDurationSec)) * 25, 7, 26),
    ));
  }

  // Generate tests feature
  const sourceFilesChanged = run.changedFiles.filter((file) =>
    /\.(ts|tsx|js|jsx|py|go|rs|java|kt)$/.test(file) && !/(\.test\.|\.spec\.|__tests__|test\/|tests\/)/i.test(file),
  );
  const testFilesChanged = run.changedFiles.filter((file) => /(\.test\.|\.spec\.|__tests__|test\/|tests\/)/i.test(file));
  const testsMissingOrSparse = run.tests.length < 5 || (sourceFilesChanged.length >= 2 && testFilesChanged.length === 0);
  if (testsMissingOrSparse) {
    const reliabilitySavings = clamp(
      4 + signals.failureRate * 18 + Math.min(sourceFilesChanged.length, 8) * 1.5 + (run.tests.length === 0 ? 5 : 0),
      6,
      26,
    );
    actions.push(actionWithEstimate({
        id: "generate-tests",
        title: "Auto-generate unit tests for untested core files",
        rationale: `Only ${run.tests.length} test signal(s) were detected while ${sourceFilesChanged.length} source file(s) changed and ${testFilesChanged.length} test file(s) changed. Adding targeted unit tests reduces failed reruns and review cycles caused by regressions escaping CI.`,
        risk: "low",
        filesToChange: ["tests/core.test.ts"],
      },
      run,
      signals,
      reliabilitySavings,
    ));
  }

  // Deduplicate by id, keeping the strongest version of overlapping recommendations.
  const byId = new Map<string, OptimizationAction>();
  for (const action of actions) {
    const existing = byId.get(action.id);
    if (!existing || action.estimatedTimeSavingsPct > existing.estimatedTimeSavingsPct) {
      byId.set(action.id, action);
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.risk !== b.risk && a.risk === "low") return -1;
    return b.estimatedTimeSavingsPct - a.estimatedTimeSavingsPct;
  });
}
