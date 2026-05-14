import { assessDeploymentRisk } from "@/app/lib/intelligence";
import type {
  IngestionPipeline,
  OptimizationPullRequestPlan,
  OrganizationProfile,
  RepositoryProfile,
  RuntimeTelemetry,
  WorkflowRun,
} from "@/app/lib/types";
import type { Prisma } from "@prisma/client";
import { GitHubAppConfigurationError, syncConnectedGitHubInstallations } from "./github-app";
import { prisma } from "./prisma";

export interface ExecutionSnapshot {
  organizations: OrganizationProfile[];
  pipelines: IngestionPipeline[];
  workflowRuns: WorkflowRun[];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function mapOrganizationRecord(org: {
  id: string;
  slug: string;
  name: string;
  plan: string;
  githubAppInstallationId: string | null;
  githubAppRepositorySelection: string | null;
  githubAppInstallationUrl: string | null;
  repositories: Array<{
    id: string;
    organizationId: string;
    fullName: string;
    name: string;
    defaultBranch: string;
    visibility: string;
    language: string;
    team: string;
    monthlyCiMinutes: number;
    monthlyCiSpendUsd: number;
    p95DurationSec: number;
    failureRatePct: number;
    flakeRatePct: number;
    cacheHitRatePct: number;
    runnerUtilizationPct: number;
    telemetryMode: string;
    telemetryScriptVersion: string | null;
    selected: boolean;
    lastIndexedAt: Date;
  }>;
}): OrganizationProfile {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan as OrganizationProfile["plan"],
    installationStatus: org.githubAppInstallationId ? "connected" : "needs_attention",
    installationId: org.githubAppInstallationId ?? undefined,
    installationRepositorySelection:
      org.githubAppRepositorySelection === "all" || org.githubAppRepositorySelection === "selected"
        ? org.githubAppRepositorySelection
        : undefined,
    installationUrl: org.githubAppInstallationUrl ?? undefined,
    repositories: org.repositories.map((repo) => ({
      id: repo.id,
      organizationId: repo.organizationId,
      name: repo.name,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      visibility: repo.visibility as OrganizationProfile["repositories"][number]["visibility"],
      language: repo.language,
      team: repo.team,
      monthlyCiMinutes: repo.monthlyCiMinutes,
      monthlyCiSpendUsd: repo.monthlyCiSpendUsd,
      p95DurationSec: repo.p95DurationSec,
      failureRatePct: repo.failureRatePct,
      flakeRatePct: repo.flakeRatePct,
      cacheHitRatePct: repo.cacheHitRatePct,
      runnerUtilizationPct: repo.runnerUtilizationPct,
      telemetryMode: repo.telemetryMode as RepositoryProfile["telemetryMode"],
      telemetryScriptVersion: repo.telemetryScriptVersion ?? undefined,
      selected: repo.selected,
      lastIndexedAt: repo.lastIndexedAt.toISOString(),
    })),
  };
}

function mapRunRecord(run: {
  id: string;
  repositoryId: string | null;
  workflowName: string;
  branch: string;
  commitSha: string;
  externalRunId: string;
  startedAt: Date;
  status: string;
  durationSec: number;
  containerLayerReuse: number;
  changedFiles: unknown;
  jobs: unknown;
  tests: unknown;
  telemetrySource: string;
  telemetryWrapperVersion: string | null;
  runtimeTelemetry: unknown;
}): WorkflowRun {
  return {
    id: run.externalRunId,
    repositoryId: run.repositoryId ?? undefined,
    workflowName: run.workflowName,
    branch: run.branch,
    commitSha: run.commitSha,
    startedAt: run.startedAt.toISOString(),
    status: run.status as WorkflowRun["status"],
    totalDurationSec: run.durationSec,
    containerLayerReuse: run.containerLayerReuse,
    changedFiles: Array.isArray(run.changedFiles) ? (run.changedFiles as string[]) : [],
    jobs: Array.isArray(run.jobs) ? (run.jobs as WorkflowRun["jobs"]) : [],
    tests: Array.isArray(run.tests) ? (run.tests as WorkflowRun["tests"]) : [],
    telemetrySource: run.telemetrySource as WorkflowRun["telemetrySource"],
    telemetryWrapperVersion: run.telemetryWrapperVersion ?? undefined,
    runtimeTelemetry:
      run.runtimeTelemetry && typeof run.runtimeTelemetry === "object"
        ? (run.runtimeTelemetry as WorkflowRun["runtimeTelemetry"])
        : undefined,
    aiScanResult: (run as any).aiScanResult?.issues ?? undefined,
  };
}

function mapPipelineRecord(pipeline: {
  organizationId: string;
  syncCursor: string;
  eventsProcessed24h: number;
  webhookDeliveryPct: number;
  checks: unknown;
}): IngestionPipeline {
  return {
    organizationId: pipeline.organizationId,
    syncCursor: pipeline.syncCursor,
    eventsProcessed24h: pipeline.eventsProcessed24h,
    webhookDeliveryPct: pipeline.webhookDeliveryPct,
    checks: Array.isArray(pipeline.checks) ? (pipeline.checks as IngestionPipeline["checks"]) : [],
  };
}

import { unstable_cache } from "next/cache";
import { filterExecForgeRuns } from "./branch-guard";


const getCachedSnapshot = unstable_cache(
  async (): Promise<ExecutionSnapshot> => {
    const organizations = await prisma.executionOrganization.findMany({
      include: {
        repositories: { orderBy: { fullName: "asc" } },
        ingestionCheckpoints: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    });

    const workflowRuns = await prisma.workflowRunSnapshot.findMany({
      include: { aiScanResult: true },
      orderBy: { startedAt: "asc" },
    });

    const pipelines = organizations.map((organization) => {
      const checkpoint = organization.ingestionCheckpoints[0];
      if (!checkpoint) {
        return {
          organizationId: organization.id,
          syncCursor: "",
          eventsProcessed24h: 0,
          webhookDeliveryPct: 0,
          checks: [],
        } satisfies IngestionPipeline;
      }
      return mapPipelineRecord(checkpoint);
    });

    return {
      organizations: organizations.map(mapOrganizationRecord),
      pipelines,
      // Filter out runs from ExecForge-owned branches (exec-intel/*) at the display layer.
      // This removes any runs ingested before the ingestion-level guard was added.
      workflowRuns: filterExecForgeRuns(workflowRuns.map(mapRunRecord)),
    };

  },
  ["execution-snapshot"],
  { revalidate: 20, tags: ["execution-snapshot"] },
);

export async function loadExecutionSnapshot(
  params: { refreshGitHubInstallations?: boolean } = {},
): Promise<ExecutionSnapshot> {
  if (params.refreshGitHubInstallations) {
    await syncConnectedGitHubInstallations().catch((error) => {
      if (error instanceof GitHubAppConfigurationError) return;
      console.error("GitHub installation repository refresh failed", error);
    });
    // After refresh, return fresh data (bypasses cache)
    const organizations = await prisma.executionOrganization.findMany({
      include: {
        repositories: { orderBy: { fullName: "asc" } },
        ingestionCheckpoints: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    });
    const workflowRuns = await prisma.workflowRunSnapshot.findMany({ include: { aiScanResult: true }, orderBy: { startedAt: "asc" } });
    const pipelines = organizations.map((organization) => {
      const checkpoint = organization.ingestionCheckpoints[0];
      if (!checkpoint) return { organizationId: organization.id, syncCursor: "", eventsProcessed24h: 0, webhookDeliveryPct: 0, checks: [] } satisfies IngestionPipeline;
      return mapPipelineRecord(checkpoint);
    });
    return { organizations: organizations.map(mapOrganizationRecord), pipelines, workflowRuns: filterExecForgeRuns(workflowRuns.map(mapRunRecord)) };
  }

  return getCachedSnapshot();
}

export async function loadOptimizationContext(params: {
  repositoryFullName?: string;
  runId?: string;
}): Promise<{ repository: RepositoryProfile; run: WorkflowRun } | null> {
  if (!params.repositoryFullName || !params.runId) {
    return null;
  }

  const repository = await prisma.executionRepository.findUnique({
    where: {
      fullName: params.repositoryFullName,
    },
  });

  const run = await prisma.workflowRunSnapshot.findUnique({
    where: {
      externalRunId: params.runId,
    },
    include: { aiScanResult: true }
  });

  if (!repository || !run || run.repositoryId !== repository.id) {
    return null;
  }

  return {
    repository: {
      id: repository.id,
      organizationId: repository.organizationId,
      name: repository.name,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      visibility: repository.visibility as RepositoryProfile["visibility"],
      language: repository.language,
      team: repository.team,
      monthlyCiMinutes: repository.monthlyCiMinutes,
      monthlyCiSpendUsd: repository.monthlyCiSpendUsd,
      p95DurationSec: repository.p95DurationSec,
      failureRatePct: repository.failureRatePct,
      flakeRatePct: repository.flakeRatePct,
      cacheHitRatePct: repository.cacheHitRatePct,
      runnerUtilizationPct: repository.runnerUtilizationPct,
      telemetryMode: repository.telemetryMode as RepositoryProfile["telemetryMode"],
      telemetryScriptVersion: repository.telemetryScriptVersion ?? undefined,
      selected: repository.selected,
      lastIndexedAt: repository.lastIndexedAt.toISOString(),
    },
    run: mapRunRecord(run),
  };
}

export async function recordOptimizationPlan(params: {
  repositoryFullName: string;
  runId: string;
  plan: OptimizationPullRequestPlan;
  liveCreationEnabled: boolean;
  pullRequest?: {
    number?: number;
    url?: string;
  };
}) {
  const repository = await prisma.executionRepository.findUnique({
    where: {
      fullName: params.repositoryFullName,
    },
  });

  if (!repository) {
    return;
  }

  await prisma.optimizationPlanRecord.create({
    data: {
      repositoryId: repository.id,
      sourceRunExternalId: params.runId,
      actionId: params.plan.actionId,
      title: params.plan.title,
      body: params.plan.body,
      risk: params.plan.risk,
      estimatedTimeSavingsPct: params.plan.estimatedTimeSavingsPct,
      estimatedCostSavingsUsdMonthly: params.plan.estimatedCostSavingsUsdMonthly,
      branchName: params.plan.branchName,
      baseBranch: params.plan.baseBranch,
      files: toJson(params.plan.files),
      guardrails: toJson(params.plan.guardrails),
      liveCreationEnabled: params.liveCreationEnabled,
      githubPullRequestNumber: params.pullRequest?.number,
      githubPullRequestUrl: params.pullRequest?.url,
    },
  });
}

export interface ExistingPlan {
  actionId: string;
  branchName: string;
  githubPullRequestNumber: number | null;
  githubPullRequestUrl: string | null;
  createdAt: string;
  plan?: OptimizationPullRequestPlan;
}

/** Return all persisted optimization plans for a given run so the UI can mark actions as "done". */
export async function loadExistingPlans(params: {
  repositoryFullName: string;
  runId: string;
}): Promise<ExistingPlan[]> {
  const repository = await prisma.executionRepository.findUnique({
    where: { fullName: params.repositoryFullName },
    select: { id: true },
  });
  if (!repository) return [];

  const records = await prisma.optimizationPlanRecord.findMany({
    where: {
      repositoryId: repository.id,
      sourceRunExternalId: params.runId,
    },
    select: {
      actionId: true,
      branchName: true,
      githubPullRequestNumber: true,
      githubPullRequestUrl: true,
      createdAt: true,
      title: true,
      body: true,
      risk: true,
      estimatedTimeSavingsPct: true,
      estimatedCostSavingsUsdMonthly: true,
      baseBranch: true,
      files: true,
      guardrails: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Keep only the most-recent plan per actionId (a user may have re-generated)
  const seen = new Set<string>();
  return records
    .filter((r) => {
      if (seen.has(r.actionId)) return false;
      seen.add(r.actionId);
      return true;
    })
    .map((r) => ({
      actionId: r.actionId,
      branchName: r.branchName,
      githubPullRequestNumber: r.githubPullRequestNumber,
      githubPullRequestUrl: r.githubPullRequestUrl,
      createdAt: r.createdAt.toISOString(),
      plan: {
        actionId: r.actionId,
        repositoryFullName: params.repositoryFullName,
        branchName: r.branchName,
        baseBranch: r.baseBranch,
        title: r.title,
        body: r.body,
        risk: r.risk as any,
        estimatedTimeSavingsPct: r.estimatedTimeSavingsPct,
        estimatedCostSavingsUsdMonthly: r.estimatedCostSavingsUsdMonthly,
        files: Array.isArray(r.files) ? (r.files as any) : [],
        guardrails: Array.isArray(r.guardrails) ? (r.guardrails as any) : [],
      },
    }));
}


export async function recordIngestionEvent(params: {
  eventType: string;
  source: string;
  status: "accepted" | "processed" | "rejected";
  organizationId?: string;
  repositoryFullName?: string;
  externalRunId?: string;
  idempotencyKey?: string;
  error?: string;
  payload: unknown;
}) {
  const data = {
    organizationId: params.organizationId,
    repositoryFullName: params.repositoryFullName,
    externalRunId: params.externalRunId,
    eventType: params.eventType,
    source: params.source,
    status: params.status,
    error: params.error,
    payload: toJson(params.payload),
    processedAt: params.status === "processed" ? new Date() : undefined,
  };

  if (params.idempotencyKey) {
    await prisma.ingestionEvent.upsert({
      where: {
        idempotencyKey: params.idempotencyKey,
      },
      update: data,
      create: {
        ...data,
        idempotencyKey: params.idempotencyKey,
      },
    });
    return;
  }

  await prisma.ingestionEvent.create({
    data,
  });
}

export async function ingestWorkflowRun(params: {
  organizationSlug: string;
  organizationName: string;
  githubAppInstallationId?: string;
  repository: {
    fullName: string;
    name: string;
    defaultBranch: string;
    visibility: string;
    language: string;
    team: string;
    selected?: boolean;
    monthlyCiMinutes: number;
    monthlyCiSpendUsd: number;
    p95DurationSec: number;
    failureRatePct: number;
    flakeRatePct: number;
    cacheHitRatePct: number;
    runnerUtilizationPct: number;
    telemetryMode?: RepositoryProfile["telemetryMode"];
    telemetryScriptVersion?: string;
    lastIndexedAt: string;
  };
  run: WorkflowRun;
  pipeline: IngestionPipeline;
}) {
  const organization = await prisma.executionOrganization.upsert({
    where: {
      slug: params.organizationSlug,
    },
    update: {
      name: params.organizationName,
      githubAppInstallationId: params.githubAppInstallationId,
    },
    create: {
      slug: params.organizationSlug,
      name: params.organizationName,
      plan: "team",
      githubAppInstallationId: params.githubAppInstallationId ?? null,
    },
  });

  const repository = await prisma.executionRepository.upsert({
    where: {
      fullName: params.repository.fullName,
    },
    update: {
      organizationId: organization.id,
      name: params.repository.name,
      defaultBranch: params.repository.defaultBranch,
      visibility: params.repository.visibility,
      language: params.repository.language,
      team: params.repository.team,
      selected: params.repository.selected ?? false,
      monthlyCiMinutes: params.repository.monthlyCiMinutes,
      monthlyCiSpendUsd: params.repository.monthlyCiSpendUsd,
      p95DurationSec: params.repository.p95DurationSec,
      failureRatePct: params.repository.failureRatePct,
      flakeRatePct: params.repository.flakeRatePct,
      cacheHitRatePct: params.repository.cacheHitRatePct,
      runnerUtilizationPct: params.repository.runnerUtilizationPct,
      telemetryMode: params.repository.telemetryMode ?? "github",
      telemetryScriptVersion: params.repository.telemetryScriptVersion,
      lastIndexedAt: new Date(params.repository.lastIndexedAt),
    },
    create: {
      organizationId: organization.id,
      fullName: params.repository.fullName,
      name: params.repository.name,
      defaultBranch: params.repository.defaultBranch,
      visibility: params.repository.visibility,
      language: params.repository.language,
      team: params.repository.team,
      selected: params.repository.selected ?? false,
      monthlyCiMinutes: params.repository.monthlyCiMinutes,
      monthlyCiSpendUsd: params.repository.monthlyCiSpendUsd,
      p95DurationSec: params.repository.p95DurationSec,
      failureRatePct: params.repository.failureRatePct,
      flakeRatePct: params.repository.flakeRatePct,
      cacheHitRatePct: params.repository.cacheHitRatePct,
      runnerUtilizationPct: params.repository.runnerUtilizationPct,
      telemetryMode: params.repository.telemetryMode ?? "github",
      telemetryScriptVersion: params.repository.telemetryScriptVersion,
      lastIndexedAt: new Date(params.repository.lastIndexedAt),
    },
  });

  // Use runId:attempt as the unique key so re-runs each get their own record.
  const externalRunId = params.run.id;

  const existing = await prisma.workflowRunSnapshot.findUnique({
    where: { externalRunId },
    select: { telemetrySource: true },
  });

  // Never let the webhook overwrite enriched telemetry that was already posted
  // by the SDK. The SDK runs DURING the job, the webhook fires AFTER — if we
  // blindly set telemetrySource back to "github" we lose the enrichment.
  const alreadyEnriched = existing?.telemetrySource === "execforge-wrapper";

  await prisma.workflowRunSnapshot.upsert({
    where: { externalRunId },
    update: {
      repositoryId: repository.id,
      workflowName: params.run.workflowName,
      branch: params.run.branch,
      commitSha: params.run.commitSha,
      status: params.run.status,
      startedAt: new Date(params.run.startedAt),
      durationSec: params.run.totalDurationSec,
      containerLayerReuse: params.run.containerLayerReuse,
      changedFiles: toJson(params.run.changedFiles),
      jobs: toJson(params.run.jobs),
      tests: toJson(params.run.tests),
      // Only update telemetry fields if they haven't been enriched yet
      ...(alreadyEnriched
        ? {}
        : {
            telemetrySource: params.run.telemetrySource ?? "github",
            telemetryWrapperVersion: params.run.telemetryWrapperVersion,
            runtimeTelemetry: params.run.runtimeTelemetry
              ? toJson(params.run.runtimeTelemetry)
              : undefined,
          }),
    },
    create: {
      repositoryId: repository.id,
      externalRunId,
      workflowName: params.run.workflowName,
      branch: params.run.branch,
      commitSha: params.run.commitSha,
      status: params.run.status,
      startedAt: new Date(params.run.startedAt),
      durationSec: params.run.totalDurationSec,
      containerLayerReuse: params.run.containerLayerReuse,
      changedFiles: toJson(params.run.changedFiles),
      jobs: toJson(params.run.jobs),
      tests: toJson(params.run.tests),
      telemetrySource: params.run.telemetrySource ?? "github",
      telemetryWrapperVersion: params.run.telemetryWrapperVersion,
      runtimeTelemetry: params.run.runtimeTelemetry
        ? toJson(params.run.runtimeTelemetry)
        : undefined,
    },
  });

  const risk = assessDeploymentRisk(params.run, {
    ...params.repository,
    id: repository.id,
    organizationId: organization.id,
    visibility: params.repository.visibility as RepositoryProfile["visibility"],
    selected: params.repository.selected ?? false,
    telemetryMode: params.repository.telemetryMode ?? "github",
  });

  await prisma.deploymentRiskAssessment.create({
    data: {
      repositoryId: repository.id,
      runExternalId: params.run.id,
      score: risk.score,
      rollbackProbability: risk.rollbackProbability,
      severity: risk.severity,
      rationale: toJson(risk.signals),
    },
  });

  await prisma.trendSnapshot.create({
    data: {
      organizationId: organization.id,
      label: params.run.id.replace("run-", "#"),
      durationSec: params.run.totalDurationSec,
      cacheHitPct: Math.round(
        (params.run.jobs.reduce((sum, job) => sum + job.cacheHitRate, 0) /
          Math.max(1, params.run.jobs.length)) *
          100,
      ),
      failureRiskPct: Math.min(
        100,
        params.run.jobs.filter((job) => job.status === "failed").length * 35 +
          params.run.jobs.filter((job) => job.status === "flaky").length * 14,
      ),
    },
  });

  await prisma.ingestionCheckpoint.upsert({
    where: {
      id: `${organization.id}:${params.pipeline.syncCursor}`,
    },
    update: {
      syncCursor: params.pipeline.syncCursor,
      eventsProcessed24h: params.pipeline.eventsProcessed24h,
      webhookDeliveryPct: params.pipeline.webhookDeliveryPct,
      checks: toJson(params.pipeline.checks),
      status: params.pipeline.webhookDeliveryPct >= 99 ? "healthy" : "warning",
    },
    create: {
      id: `${organization.id}:${params.pipeline.syncCursor}`,
      organizationId: organization.id,
      syncCursor: params.pipeline.syncCursor,
      eventsProcessed24h: params.pipeline.eventsProcessed24h,
      webhookDeliveryPct: params.pipeline.webhookDeliveryPct,
      checks: toJson(params.pipeline.checks),
      status: params.pipeline.webhookDeliveryPct >= 99 ? "healthy" : "warning",
    },
  });
}

export async function attachRuntimeTelemetry(params: {
  repositoryFullName: string;
  runId: string;
  workflowName?: string;
  branch?: string;
  commitSha?: string;
  telemetry: RuntimeTelemetry;
  /** Organization context from the validated ingestion token — used to
   *  auto-provision the repository when it hasn't been added to ExecForge yet. */
  organizationId?: string;
}) {
  let repository = await prisma.executionRepository.findUnique({
    where: {
      fullName: params.repositoryFullName,
    },
  });

  // Auto-provision: if the repo isn't known yet but we have an org context
  // (from the ingestion token), create it automatically so the first CI run
  // is captured without requiring the user to add the repo via the UI first.
  if (!repository && params.organizationId) {
    const organization = await prisma.executionOrganization.findUnique({
      where: { id: params.organizationId },
    });

    if (organization) {
      const repoName = params.repositoryFullName.split("/")[1] ?? params.repositoryFullName;
      repository = await prisma.executionRepository.upsert({
        where: { fullName: params.repositoryFullName },
        update: { organizationId: organization.id },
        create: {
          organizationId: organization.id,
          fullName: params.repositoryFullName,
          name: repoName,
          defaultBranch: params.branch ?? "main",
          visibility: "private",
          language: "Unknown",
          team: organization.slug,
          selected: true,
          monthlyCiMinutes: 0,
          monthlyCiSpendUsd: 0,
          p95DurationSec: 0,
          failureRatePct: 0,
          flakeRatePct: 0,
          cacheHitRatePct: 0,
          runnerUtilizationPct: 0,
          telemetryMode: "execforge-wrapper",
          lastIndexedAt: new Date(),
        },
      });
    }
  }

  if (!repository) {
    return { attached: false, reason: "repository_not_found" as const };
  }

  const existingRun = await prisma.workflowRunSnapshot.findUnique({
    where: {
      externalRunId: params.runId,
    },
  });

  if (existingRun && existingRun.repositoryId !== repository.id) {
    return { attached: false, reason: "run_not_found" as const };
  }

  const fallbackStartedAt = new Date();
  const parsedStartedAt = params.telemetry.captureStartedAt
    ? new Date(params.telemetry.captureStartedAt)
    : fallbackStartedAt;
  const startedAt = Number.isFinite(parsedStartedAt.getTime())
    ? parsedStartedAt
    : fallbackStartedAt;
  const parsedFinishedAt = params.telemetry.captureFinishedAt
    ? new Date(params.telemetry.captureFinishedAt)
    : startedAt;
  const finishedAt = Number.isFinite(parsedFinishedAt.getTime())
    ? parsedFinishedAt
    : startedAt;
  const durationSec = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  const status = params.telemetry.exitCode && params.telemetry.exitCode !== 0 ? "failed" : "success";

  await prisma.$transaction([
    prisma.workflowRunSnapshot.upsert({
      where: {
        externalRunId: params.runId,
      },
      update: {
        telemetrySource: params.telemetry.source,
        telemetryWrapperVersion: params.telemetry.wrapperVersion,
        runtimeTelemetry: toJson(params.telemetry),
      },
      create: {
        repositoryId: repository.id,
        externalRunId: params.runId,
        workflowName: params.workflowName ?? "GitHub Actions workflow",
        branch: params.branch ?? repository.defaultBranch,
        commitSha: params.commitSha ?? "",
        status,
        startedAt,
        durationSec,
        containerLayerReuse: 0,
        changedFiles: [],
        jobs: [],
        tests: [],
        telemetrySource: params.telemetry.source,
        telemetryWrapperVersion: params.telemetry.wrapperVersion,
        runtimeTelemetry: toJson(params.telemetry),
      },
    }),
    prisma.executionRepository.update({
      where: {
        id: repository.id,
      },
      data: {
        telemetryMode: params.telemetry.source,
        telemetryScriptVersion: params.telemetry.wrapperVersion,
        lastIndexedAt: new Date(),
      },
    }),
  ]);

  return { attached: true, reason: null };
}
