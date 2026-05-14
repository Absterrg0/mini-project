import type { OrganizationProfile, RepositoryProfile, WorkflowRun } from "@/app/lib/types";

export type TelemetryCoverageStatus =
  | "github_only"
  | "enriched"
  | "stale"
  | "ingestion_failing";

export interface RepositoryTelemetryCoverage {
  repositoryId: string;
  fullName: string;
  status: TelemetryCoverageStatus;
  telemetryMode: RepositoryProfile["telemetryMode"];
  scriptVersion?: string;
  lastIndexedAt: string;
  latestRunId?: string;
  latestRunStartedAt?: string;
  sampleCount: number;
  detail: string;
}

export interface FailureCluster {
  key: string;
  title: string;
  count: number;
  affectedRepositories: string[];
  latestRunId: string;
  severity: "low" | "medium" | "high";
}

function daysSince(value: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - time) / 86_400_000;
}

export function buildTelemetryCoverage(
  org: OrganizationProfile,
  runs: WorkflowRun[],
): RepositoryTelemetryCoverage[] {
  const runsByRepo = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    if (!run.repositoryId) {
      continue;
    }
    const current = runsByRepo.get(run.repositoryId) ?? [];
    current.push(run);
    runsByRepo.set(run.repositoryId, current);
  }

  return org.repositories.map((repo) => {
    const repoRuns = (runsByRepo.get(repo.id) ?? []).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    const latestRun = repoRuns[0];
    const sampleCount = latestRun?.runtimeTelemetry?.samples.length ?? 0;
    const hasRecentData = daysSince(latestRun?.startedAt ?? repo.lastIndexedAt) <= 7;

    if (!hasRecentData) {
      return {
        repositoryId: repo.id,
        fullName: repo.fullName,
        status: "stale",
        telemetryMode: repo.telemetryMode,
        scriptVersion: repo.telemetryScriptVersion,
        lastIndexedAt: repo.lastIndexedAt,
        latestRunId: latestRun?.id,
        latestRunStartedAt: latestRun?.startedAt,
        sampleCount,
        detail: "No workflow telemetry has been indexed in the last 7 days.",
      };
    }

    if (repo.telemetryMode === "execforge-wrapper" && sampleCount === 0) {
      return {
        repositoryId: repo.id,
        fullName: repo.fullName,
        status: "ingestion_failing",
        telemetryMode: repo.telemetryMode,
        scriptVersion: repo.telemetryScriptVersion,
        lastIndexedAt: repo.lastIndexedAt,
        latestRunId: latestRun?.id,
        latestRunStartedAt: latestRun?.startedAt,
        sampleCount,
        detail: "Wrapper is marked installed, but the latest run has no runtime samples.",
      };
    }

    if (latestRun?.telemetrySource === "execforge-wrapper" && sampleCount > 0) {
      return {
        repositoryId: repo.id,
        fullName: repo.fullName,
        status: "enriched",
        telemetryMode: repo.telemetryMode,
        scriptVersion: latestRun.telemetryWrapperVersion ?? repo.telemetryScriptVersion,
        lastIndexedAt: repo.lastIndexedAt,
        latestRunId: latestRun.id,
        latestRunStartedAt: latestRun.startedAt,
        sampleCount,
        detail: "Runtime wrapper samples are flowing for the latest indexed run.",
      };
    }

    return {
      repositoryId: repo.id,
      fullName: repo.fullName,
      status: "github_only",
      telemetryMode: repo.telemetryMode,
      scriptVersion: repo.telemetryScriptVersion,
      lastIndexedAt: repo.lastIndexedAt,
      latestRunId: latestRun?.id,
      latestRunStartedAt: latestRun?.startedAt,
      sampleCount,
      detail: "GitHub Actions metadata is available; install the runtime action for process-level samples.",
    };
  });
}

export function clusterFailures(
  org: OrganizationProfile,
  runs: WorkflowRun[],
): FailureCluster[] {
  const repoById = new Map(org.repositories.map((repo) => [repo.id, repo.fullName]));
  const clusters = new Map<string, FailureCluster>();

  for (const run of runs) {
    const repositoryName = run.repositoryId ? repoById.get(run.repositoryId) : undefined;
    if (!repositoryName || run.status === "success") {
      continue;
    }

    const failedSteps = run.jobs.flatMap((job) =>
      job.steps
        .filter((step) => step.status === "failed" || step.retries > 0)
        .map((step) => ({ job, step })),
    );

    for (const { job, step } of failedSteps) {
      const normalized = step.name.toLowerCase();
      const key = normalized.includes("install")
        ? "dependency-install"
        : normalized.includes("docker")
          ? "docker-build"
          : normalized.includes("test")
            ? "test-failure"
            : job.status === "flaky"
              ? "flaky-test"
              : "workflow-step";

      const current =
        clusters.get(key) ??
        {
          key,
          title: key
            .split("-")
            .map((part) => part[0].toUpperCase() + part.slice(1))
            .join(" "),
          count: 0,
          affectedRepositories: [],
          latestRunId: run.id,
          severity: "low" as const,
        };

      current.count += 1;
      current.latestRunId = run.id;
      if (!current.affectedRepositories.includes(repositoryName)) {
        current.affectedRepositories.push(repositoryName);
      }
      current.severity = current.count >= 6 ? "high" : current.count >= 3 ? "medium" : "low";
      clusters.set(key, current);
    }
  }

  return [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 6);
}
