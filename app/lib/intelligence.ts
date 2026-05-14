import type {
  IngestionPipeline,
  JobExecution,
  OptimizationAction,
  OrganizationProfile,
  RepositoryProfile,
  StepExecution,
  WorkflowRun,
} from "./types";

export interface CriticalPathResult {
  path: string[];
  totalSec: number;
}

export interface RootCauseItem {
  title: string;
  impactPct: number;
  detail: string;
}

export interface FlakyTestInsight {
  name: string;
  file: string;
  flakeRate: number;
  retriesPerFailure: number;
  confidenceDropScore: number;
}

export interface TrendPoint {
  label: string;
  durationSec: number;
  cacheHitPct: number;
  failureRiskPct: number;
}

export interface OrgScorecard {
  selectedRepos: number;
  monthlyCiSpendUsd: number;
  monthlyCiMinutes: number;
  avoidableSpendUsd: number;
  averageCacheHitPct: number;
  averageFailureRatePct: number;
  p95DurationSec: number;
}

export interface CapacityInsight {
  title: string;
  value: string;
  detail: string;
  severity: "good" | "warning" | "danger";
}

export interface DeploymentRiskAssessmentResult {
  score: number;
  rollbackProbability: number;
  severity: "low" | "medium" | "high" | "critical";
  signals: string[];
}

interface SimConfig {
  enableRemoteCache: boolean;
  splitMonolithicJobs: boolean;
  optimizeDockerLayers: boolean;
  parallelizeE2E: boolean;
}

function sortJobsTopologically(jobs: JobExecution[]): JobExecution[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const byId = new Map(jobs.map((job) => [job.id, job]));

  for (const job of jobs) {
    inDegree.set(job.id, job.dependsOn.length);
    for (const dep of job.dependsOn) {
      const neighbors = adjacency.get(dep) ?? [];
      neighbors.push(job.id);
      adjacency.set(dep, neighbors);
    }
  }

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) {
      queue.push(id);
    }
  });

  const ordered: JobExecution[] = [];

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const currentJob = byId.get(current);
    if (currentJob) {
      ordered.push(currentJob);
    }

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const deg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        queue.push(neighbor);
      }
    }
  }

  return ordered;
}

export function computeCriticalPath(run: WorkflowRun): CriticalPathResult {
  const orderedJobs = sortJobsTopologically(run.jobs);
  const bestCostToNode = new Map<string, number>();
  const prevNode = new Map<string, string | null>();

  for (const job of orderedJobs) {
    const ownCost = job.durationSec + job.queueSec;

    if (job.dependsOn.length === 0) {
      bestCostToNode.set(job.id, ownCost);
      prevNode.set(job.id, null);
      continue;
    }

    let bestParent = job.dependsOn[0];
    let bestParentCost = bestCostToNode.get(bestParent) ?? 0;

    for (const parent of job.dependsOn.slice(1)) {
      const parentCost = bestCostToNode.get(parent) ?? 0;
      if (parentCost > bestParentCost) {
        bestParent = parent;
        bestParentCost = parentCost;
      }
    }

    bestCostToNode.set(job.id, bestParentCost + ownCost);
    prevNode.set(job.id, bestParent);
  }

  let bestLeafId = "";
  let bestLeafCost = -1;

  for (const [id, cost] of bestCostToNode.entries()) {
    if (cost > bestLeafCost) {
      bestLeafCost = cost;
      bestLeafId = id;
    }
  }

  const path: string[] = [];
  let cursor: string | null = bestLeafId;

  while (cursor) {
    path.unshift(cursor);
    cursor = prevNode.get(cursor) ?? null;
  }

  return {
    path,
    totalSec: Math.max(0, bestLeafCost),
  };
}

export function findBottleneckJobs(run: WorkflowRun): JobExecution[] {
  return [...run.jobs].sort(
    (a, b) => b.durationSec + b.queueSec - (a.durationSec + a.queueSec),
  );
}

export function cacheWasteScore(run: WorkflowRun): number {
  const avgCache =
    run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) / Math.max(1, run.jobs.length);
  return Number(((1 - avgCache) * 100).toFixed(1));
}

export function inferRootCause(
  currentRun: WorkflowRun,
  baselineRun: WorkflowRun,
): RootCauseItem[] {
  const rootCauses: RootCauseItem[] = [];

  const previousById = new Map(baselineRun.jobs.map((job) => [job.id, job]));

  for (const job of currentRun.jobs) {
    const baseline = previousById.get(job.id);
    if (!baseline) {
      continue;
    }

    const currentTotal = job.durationSec + job.queueSec;
    const previousTotal = baseline.durationSec + baseline.queueSec;
    const delta = currentTotal - previousTotal;

    if (delta <= 20) {
      continue;
    }

    const impactPct = Number(((delta / Math.max(1, previousTotal)) * 100).toFixed(1));
    const cacheDelta = Number(((baseline.cacheHitRate - job.cacheHitRate) * 100).toFixed(1));

    rootCauses.push({
      title: `${job.name} regression`,
      impactPct,
      detail: `+${delta}s vs baseline. Cache hit change: ${cacheDelta}pp.`,
    });
  }

  const browserInstallStep = currentRun.jobs
    .flatMap((job) => job.steps)
    .find((step) => step.name.toLowerCase().includes("browsers"));

  if (browserInstallStep && browserInstallStep.durationSec > 120) {
    rootCauses.push({
      title: "Playwright browser install overhead",
      impactPct: 18.9,
      detail: `${browserInstallStep.durationSec}s spent downloading browsers on each run due to weak cache locality.`,
    });
  }

  if (currentRun.changedFiles.some((file) => file.endsWith("package.json"))) {
    rootCauses.push({
      title: "Dependency manifest change invalidated cache",
      impactPct: 24.2,
      detail: "Dependency layer invalidation propagated to test, e2e, and image build stages.",
    });
  }

  return rootCauses.sort((a, b) => b.impactPct - a.impactPct).slice(0, 4);
}

export function detectFlakyTests(runs: WorkflowRun[]): FlakyTestInsight[] {
  const map = new Map<
    string,
    {
      name: string;
      file: string;
      runs: number;
      failures: number;
      retries: number;
      avgDurationSecWeighted: number;
    }
  >();

  for (const run of runs) {
    for (const test of run.tests) {
      const key = `${test.file}::${test.name}`;
      const existing =
        map.get(key) ??
        {
          name: test.name,
          file: test.file,
          runs: 0,
          failures: 0,
          retries: 0,
          avgDurationSecWeighted: 0,
        };

      existing.runs += test.runs;
      existing.failures += test.failures;
      existing.retries += test.retries;
      existing.avgDurationSecWeighted += test.avgDurationSec * test.runs;

      map.set(key, existing);
    }
  }

  const insights: FlakyTestInsight[] = [];

  for (const aggregated of map.values()) {
    if (aggregated.failures === 0) {
      continue;
    }

    const flakeRate = aggregated.failures / Math.max(1, aggregated.runs);
    if (flakeRate < 0.04) {
      continue;
    }

    const retriesPerFailure = aggregated.retries / Math.max(1, aggregated.failures);
    const meanDuration = aggregated.avgDurationSecWeighted / Math.max(1, aggregated.runs);
    const confidenceDropScore = Number(
      ((flakeRate * 100 * 0.7 + retriesPerFailure * 8 + meanDuration * 0.3) * 1.4).toFixed(
        1,
      ),
    );

    insights.push({
      name: aggregated.name,
      file: aggregated.file,
      flakeRate: Number((flakeRate * 100).toFixed(1)),
      retriesPerFailure: Number(retriesPerFailure.toFixed(2)),
      confidenceDropScore,
    });
  }

  return insights.sort((a, b) => b.confidenceDropScore - a.confidenceDropScore).slice(0, 10);
}

export function suggestOptimizations(run: WorkflowRun): OptimizationAction[] {
  const actions: OptimizationAction[] = [];

  if (run.telemetrySource !== "execforge-wrapper") {
    actions.push({
      id: "install-telemetry-wrapper",
      title: "Install ExecForge runtime action",
      rationale:
        "GitHub timing data explains workflow status, but not process-level CPU, memory, artifact, and runner pressure. The wrapper adds pre/post capture around existing jobs without requiring workflows to be rebuilt on this platform.",
      estimatedTimeSavingsPct: 0,
      estimatedCostSavingsUsdMonthly: 0,
      risk: "low",
      filesToChange: [
        ".github/workflows/execforge-runtime-example.yml",
        ".github/execforge/README.md",
      ],
    });
  }

  const buildJob = run.jobs.find((job) => job.id === "build");
  if (buildJob && buildJob.cacheHitRate < 0.5) {
    actions.push({
      id: "split-docker-stages",
      title: "Split Dockerfile stages for dependency and app layers",
      rationale:
        "Build layers are frequently invalidated by app-level changes. Separating dependency and generation stages preserves reusable layers.",
      estimatedTimeSavingsPct: 31,
      estimatedCostSavingsUsdMonthly: 840,
      risk: "low",
      filesToChange: ["Dockerfile", ".github/workflows/ci.yml"],
    });
  }

  const e2eJob = run.jobs.find((job) => job.id === "e2e");
  if (e2eJob) {
    actions.push({
      id: "e2e-matrix",
      title: "Shard E2E suite across matrix workers",
      rationale:
        "The E2E stage is the longest parallel branch and currently serial. Matrix sharding reduces wall-clock critical path.",
      estimatedTimeSavingsPct: 27,
      estimatedCostSavingsUsdMonthly: 510,
      risk: "medium",
      filesToChange: [".github/workflows/e2e.yml", "playwright.config.ts"],
    });
  }

  const testJob = run.jobs.find((job) => job.id === "test");
  if (testJob && testJob.status === "flaky") {
    actions.push({
      id: "flaky-quarantine",
      title: "Auto-quarantine top flaky tests and open stabilization issues",
      rationale:
        "Retries are masking deterministic signal and inflating queue pressure. Quarantining unstable tests restores trust in green builds.",
      estimatedTimeSavingsPct: 12,
      estimatedCostSavingsUsdMonthly: 190,
      risk: "medium",
      filesToChange: ["jest.config.ts", "tests/flaky.allowlist.json"],
    });
  }

  actions.push({
    id: "remote-cache",
    title: "Enable remote cache hydration for install and build tasks",
    rationale:
      "Current run shows broad cache miss patterns across lint, test, and build. Remote cache improves cross-run and cross-branch reuse.",
    estimatedTimeSavingsPct: 18,
    estimatedCostSavingsUsdMonthly: 320,
    risk: "low",
    filesToChange: ["turbo.json", ".github/workflows/ci.yml"],
  });

  return actions;
}

export function estimateSimulation(
  run: WorkflowRun,
  config: SimConfig,
): {
  projectedSec: number;
  timeSavedSec: number;
  projectedCacheHitRate: number;
} {
  let duration = run.totalDurationSec;
  let cacheLift = 0;

  if (config.enableRemoteCache) {
    duration *= 0.87;
    cacheLift += 0.12;
  }

  if (config.splitMonolithicJobs) {
    duration *= 0.91;
    cacheLift += 0.05;
  }

  if (config.optimizeDockerLayers) {
    duration *= 0.9;
    cacheLift += 0.1;
  }

  if (config.parallelizeE2E) {
    duration *= 0.82;
    cacheLift += 0.04;
  }

  const currentAvgCache =
    run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) / Math.max(1, run.jobs.length);

  const projectedCacheHitRate = Math.min(0.98, currentAvgCache + cacheLift);

  return {
    projectedSec: Math.round(duration),
    timeSavedSec: Math.max(0, run.totalDurationSec - Math.round(duration)),
    projectedCacheHitRate: Number((projectedCacheHitRate * 100).toFixed(1)),
  };
}

export function buildTrend(runs: WorkflowRun[]): TrendPoint[] {
  return [...runs]
    .sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    )
    .map((run) => {
      const avgCache =
        run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) /
        Math.max(1, run.jobs.length);
      const failedJobs = run.jobs.filter((job) => job.status === "failed").length;
      const flakyJobs = run.jobs.filter((job) => job.status === "flaky").length;

      return {
        label: run.id.replace("run-", "#"),
        durationSec: run.totalDurationSec,
        cacheHitPct: Math.round(avgCache * 100),
        failureRiskPct: Math.min(100, failedJobs * 35 + flakyJobs * 14),
      };
    });
}

export function scoreOrganization(org: OrganizationProfile): OrgScorecard {
  const selectedRepos = org.repositories.filter((repo) => repo.selected);
  const repos = selectedRepos.length > 0 ? selectedRepos : org.repositories;
  const monthlyCiSpendUsd = repos.reduce((sum, repo) => sum + repo.monthlyCiSpendUsd, 0);
  const monthlyCiMinutes = repos.reduce((sum, repo) => sum + repo.monthlyCiMinutes, 0);
  const averageCacheHitPct = Math.round(
    repos.reduce((sum, repo) => sum + repo.cacheHitRatePct, 0) /
      Math.max(1, repos.length),
  );
  const averageFailureRatePct = Number(
    (
      repos.reduce((sum, repo) => sum + repo.failureRatePct, 0) /
      Math.max(1, repos.length)
    ).toFixed(1),
  );
  const p95DurationSec = Math.max(...repos.map((repo) => repo.p95DurationSec), 0);
  const avoidableSpendUsd = Math.round(
    repos.reduce((sum, repo) => {
      const cacheWaste = Math.max(0, 78 - repo.cacheHitRatePct) / 100;
      const flakeWaste = repo.flakeRatePct / 100;
      return sum + repo.monthlyCiSpendUsd * Math.min(0.42, cacheWaste + flakeWaste);
    }, 0),
  );

  return {
    selectedRepos: repos.length,
    monthlyCiSpendUsd,
    monthlyCiMinutes,
    avoidableSpendUsd,
    averageCacheHitPct,
    averageFailureRatePct,
    p95DurationSec,
  };
}

export function rankRepositoriesByWaste(
  repos: RepositoryProfile[],
): Array<RepositoryProfile & { wasteUsd: number; priorityScore: number }> {
  return repos
    .map((repo) => {
      const cacheWaste = Math.max(0, 85 - repo.cacheHitRatePct);
      const queuePressure = Math.max(0, repo.runnerUtilizationPct - 70);
      const priorityScore = Number(
        (cacheWaste * 0.42 + repo.failureRatePct * 2.1 + repo.flakeRatePct * 2.4 + queuePressure * 0.7).toFixed(
          1,
        ),
      );
      const wasteUsd = Math.round(
        repo.monthlyCiSpendUsd *
          Math.min(0.45, cacheWaste / 120 + repo.flakeRatePct / 160),
      );

      return {
        ...repo,
        wasteUsd,
        priorityScore,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export function buildCapacityInsights(
  org: OrganizationProfile,
  pipeline?: IngestionPipeline,
): CapacityInsight[] {
  const scorecard = scoreOrganization(org);
  const hottestRepo = [...org.repositories].sort(
    (a, b) => b.runnerUtilizationPct - a.runnerUtilizationPct,
  )[0];
  const webhookDelivery = pipeline?.webhookDeliveryPct ?? 0;

  return [
    {
      title: "Runner Saturation",
      value: hottestRepo ? `${hottestRepo.runnerUtilizationPct}%` : "n/a",
      detail: hottestRepo
        ? `${hottestRepo.fullName} is close to the queue cliff for peak-hour pushes.`
        : "Connect repositories to model runner pressure.",
      severity:
        hottestRepo && hottestRepo.runnerUtilizationPct > 85
          ? "danger"
          : hottestRepo && hottestRepo.runnerUtilizationPct > 72
            ? "warning"
            : "good",
    },
    {
      title: "Avoidable CI Spend",
      value: `$${scorecard.avoidableSpendUsd.toLocaleString()}`,
      detail: "Modeled monthly waste from cache misses, flakes, and queue amplification.",
      severity: scorecard.avoidableSpendUsd > 1800 ? "warning" : "good",
    },
    {
      title: "Webhook SLO",
      value: webhookDelivery ? `${webhookDelivery}%` : "pending",
      detail: "Delivery rate for GitHub App workflow, check suite, and PR events.",
      severity: webhookDelivery >= 99.9 ? "good" : webhookDelivery >= 98 ? "warning" : "danger",
    },
  ];
}

export function assessDeploymentRisk(
  run: WorkflowRun,
  repository?: RepositoryProfile,
): DeploymentRiskAssessmentResult {
  const failedJobs = run.jobs.filter((job) => job.status === "failed").length;
  const flakyJobs = run.jobs.filter((job) => job.status === "flaky").length;
  const averageQueueSec = run.jobs.reduce((sum, job) => sum + job.queueSec, 0) / Math.max(1, run.jobs.length);
  const averageCacheHit = run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) / Math.max(1, run.jobs.length);
  const retryCount = run.jobs.flatMap((job) => job.steps).reduce((sum, step) => sum + step.retries, 0);
  const changedFilesPressure = run.changedFiles.length * 2.2;
  const durationPressure = Math.min(24, run.totalDurationSec / 180);
  const cachePressure = Math.max(0, 70 - averageCacheHit * 100) * 0.55;
  const repoFailurePressure = (repository?.failureRatePct ?? 0) * 1.8;
  const repoFlakePressure = (repository?.flakeRatePct ?? 0) * 1.4;

  const score = Math.min(
    100,
    Math.round(
      18 +
        failedJobs * 19 +
        flakyJobs * 11 +
        averageQueueSec * 0.28 +
        retryCount * 6 +
        changedFilesPressure +
        durationPressure +
        cachePressure +
        repoFailurePressure +
        repoFlakePressure,
    ),
  );

  const rollbackProbability = Math.min(
    0.94,
    Number((score / 100 * 0.72 + failedJobs * 0.04 + flakyJobs * 0.02).toFixed(2)),
  );

  const severity =
    score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";

  const signals = [
    `${failedJobs} failed jobs`,
    `${flakyJobs} flaky jobs`,
    `${retryCount} retries`,
    `${run.changedFiles.length} changed files`,
  ];

  return {
    score,
    rollbackProbability,
    severity,
    signals,
  };
}

export function formatDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function flattenSteps(run: WorkflowRun): Array<StepExecution & { jobName: string }> {
  const flat: Array<StepExecution & { jobName: string }> = [];
  for (const job of run.jobs) {
    for (const step of job.steps) {
      flat.push({
        ...step,
        jobName: job.name,
      });
    }
  }
  return flat;
}
