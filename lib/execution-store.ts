import { randomUUID } from "node:crypto";
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
import {
  GitHubAppConfigurationError,
  getRepositoryInstallationId,
  githubInstallationRequest,
  loadTestsFromGitHubWorkflowRun,
  syncConnectedGitHubInstallations,
} from "./github-app";
import { prisma } from "./prisma";
import { deriveWorkflowRunTelemetrySource, isExecForgeEnrichedRuntime } from "./telemetry-contract";

export interface ExecutionSnapshot {
  organizations: OrganizationProfile[];
  pipelines: IngestionPipeline[];
  workflowRuns: WorkflowRun[];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const globalForIngestionEvents = globalThis as unknown as {
  ingestionEventWriteQueue?: Promise<void>;
};

const transientDatabaseErrorCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "57P01",
  "57P02",
  "57P03",
]);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code ? transientDatabaseErrorCodes.has(code) : false;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransientDatabaseError<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === 2) break;
      await wait(150 * 2 ** attempt);
    }
  }

  throw lastError;
}

function enqueueIngestionEventWrite(operation: () => Promise<void>) {
  const previous = globalForIngestionEvents.ingestionEventWriteQueue ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => retryTransientDatabaseError(operation));

  globalForIngestionEvents.ingestionEventWriteQueue = next.catch(() => undefined);

  return next;
}

async function writeIngestionEvent(params: {
  organizationId?: string | null;
  repositoryFullName?: string | null;
  externalRunId?: string | null;
  eventType: string;
  source: string;
  status: "accepted" | "processed" | "rejected";
  error?: string | null;
  payload: unknown;
  processedAt?: Date | null;
  idempotencyKey?: string | null;
}) {
  const payload = JSON.stringify(params.payload);

  if (params.idempotencyKey) {
    await prisma.$executeRawUnsafe(
      `
        insert into "IngestionEvent" (
          "id",
          "organizationId",
          "repositoryFullName",
          "externalRunId",
          "idempotencyKey",
          "eventType",
          "source",
          "status",
          "error",
          "payload",
          "processedAt"
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
        on conflict ("idempotencyKey") do update set
          "organizationId" = excluded."organizationId",
          "repositoryFullName" = excluded."repositoryFullName",
          "externalRunId" = excluded."externalRunId",
          "eventType" = excluded."eventType",
          "source" = excluded."source",
          "status" = excluded."status",
          "error" = excluded."error",
          "payload" = excluded."payload",
          "processedAt" = excluded."processedAt"
      `,
      randomUUID(),
      params.organizationId ?? null,
      params.repositoryFullName ?? null,
      params.externalRunId ?? null,
      params.idempotencyKey,
      params.eventType,
      params.source,
      params.status,
      params.error ?? null,
      payload,
      params.processedAt ?? null,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      insert into "IngestionEvent" (
        "id",
        "organizationId",
        "repositoryFullName",
        "externalRunId",
        "eventType",
        "source",
        "status",
        "error",
        "payload",
        "processedAt"
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
    `,
    randomUUID(),
    params.organizationId ?? null,
    params.repositoryFullName ?? null,
    params.externalRunId ?? null,
    params.eventType,
    params.source,
    params.status,
    params.error ?? null,
    payload,
    params.processedAt ?? null,
  );
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
    telemetrySource: deriveWorkflowRunTelemetrySource(run.telemetrySource, run.runtimeTelemetry),
    telemetryWrapperVersion: run.telemetryWrapperVersion ?? undefined,
    runtimeTelemetry:
      run.runtimeTelemetry && typeof run.runtimeTelemetry === "object"
        ? (run.runtimeTelemetry as WorkflowRun["runtimeTelemetry"])
        : undefined,
    aiScanResult: (run as { aiScanResult?: { issues?: unknown; scannedCommitSha?: string | null } | null })
      .aiScanResult?.issues ?? undefined,
    aiScanScannedCommitSha:
      (run as { aiScanResult?: { scannedCommitSha?: string | null } | null }).aiScanResult?.scannedCommitSha ?? undefined,
    runAnalysis: (() => {
      const ra = (run as { runAnalysis?: { markdown: string; model: string; createdAt: Date } | null }).runAnalysis;
      if (!ra) return null;
      return { markdown: ra.markdown, model: ra.model, createdAt: ra.createdAt.toISOString() };
    })(),
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
      include: { aiScanResult: true, runAnalysis: true },
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
    const workflowRuns = await prisma.workflowRunSnapshot.findMany({ include: { aiScanResult: true, runAnalysis: true }, orderBy: { startedAt: "asc" } });
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
  githubPullRequestStatus: "raised" | "merged" | null;
  createdAt: string;
  plan?: OptimizationPullRequestPlan;
}

function stripNonFunctionalPlanText(content: string, path: string) {
  const lowerPath = path.toLowerCase();
  if (/\.(ya?ml)$/.test(lowerPath)) {
    return content
      .split("\n")
      .map((line) => line.replace(/\s+#.*$/, "").trimEnd())
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#");
      })
      .join("\n")
      .trim();
  }

  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\s+\/\/.*$/, "").trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("//");
    })
    .join("\n")
    .trim();
}

function isUsablePersistedPlan(plan: OptimizationPullRequestPlan) {
  if (!plan.files.length) return false;

  return plan.files.some((file) => {
    if (file.operation === "create" && !file.oldContent) {
      return stripNonFunctionalPlanText(file.content, file.path).length > 0;
    }

    if (typeof file.oldContent !== "string") {
      return stripNonFunctionalPlanText(file.content, file.path).length > 0;
    }

    return stripNonFunctionalPlanText(file.oldContent, file.path) !== stripNonFunctionalPlanText(file.content, file.path);
  });
}

async function getPullRequestStatus(params: {
  repositoryFullName: string;
  pullRequestNumber: number | null;
}): Promise<ExistingPlan["githubPullRequestStatus"]> {
  if (!params.pullRequestNumber) return null;

  try {
    const installationId = await getRepositoryInstallationId(params.repositoryFullName);
    if (!installationId) return "raised";

    const [owner, repo] = params.repositoryFullName.split("/");
    const response = await githubInstallationRequest<{
      merged_at?: string | null;
      state?: string;
    }>(installationId, `/repos/${owner}/${repo}/pulls/${params.pullRequestNumber}`);

    if (!response.ok) return "raised";
    return response.data?.merged_at ? "merged" : "raised";
  } catch (error) {
    if (!(error instanceof GitHubAppConfigurationError)) {
      console.error("Failed to refresh pull request status", error);
    }
    return "raised";
  }
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
  const latestRecords = records
    .filter((r) => {
      if (seen.has(r.actionId)) return false;
      seen.add(r.actionId);
      return true;
    });

  return Promise.all(latestRecords.map(async (r) => {
    const plan = {
      actionId: r.actionId,
      repositoryFullName: params.repositoryFullName,
      branchName: r.branchName,
      baseBranch: r.baseBranch,
      title: r.title,
      body: r.body,
      risk: r.risk as OptimizationPullRequestPlan["risk"],
      estimatedTimeSavingsPct: r.estimatedTimeSavingsPct,
      estimatedCostSavingsUsdMonthly: r.estimatedCostSavingsUsdMonthly,
      files: Array.isArray(r.files) ? (r.files as unknown as OptimizationPullRequestPlan["files"]) : [],
      guardrails: Array.isArray(r.guardrails) ? (r.guardrails as OptimizationPullRequestPlan["guardrails"]) : [],
    };

    return {
      actionId: r.actionId,
      branchName: r.branchName,
      githubPullRequestNumber: r.githubPullRequestNumber,
      githubPullRequestUrl: r.githubPullRequestUrl,
      githubPullRequestStatus: await getPullRequestStatus({
        repositoryFullName: params.repositoryFullName,
        pullRequestNumber: r.githubPullRequestNumber,
      }),
      createdAt: r.createdAt.toISOString(),
      plan: isUsablePersistedPlan(plan) ? plan : undefined,
    };
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

  await enqueueIngestionEventWrite(() =>
    writeIngestionEvent({
      ...data,
      idempotencyKey: params.idempotencyKey,
    }),
  );
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
    select: { telemetrySource: true, runtimeTelemetry: true },
  });

  // Never let the webhook overwrite enriched telemetry that was already posted
  // by the SDK. The SDK runs DURING the job, the webhook fires AFTER — if we
  // blindly set telemetrySource back to "github" we lose the enrichment.
  // Also treat persisted runtime JSON as enriched so a merge race cannot wipe
  // samples when the column briefly disagrees with the payload.
  const alreadyEnriched =
    existing?.telemetrySource === "execforge-wrapper" ||
    isExecForgeEnrichedRuntime(existing?.runtimeTelemetry);

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
  // Preserve any tests already written to this run (e.g. from a prior webhook event).
  // Do NOT attempt to fetch tests from GitHub here — the SDK posts telemetry while the
  // job is still in-progress, so the logs API will not yet contain test output.
  // Test parsing is handled by the workflow_job completed webhook handler, which fires
  // after the job is fully done and log files are guaranteed available.
  const tests: unknown = Array.isArray(existingRun?.tests) ? existingRun.tests : [];

  await prisma.$transaction([
    prisma.workflowRunSnapshot.upsert({
      where: {
        externalRunId: params.runId,
      },
      update: {
        telemetrySource: params.telemetry.source,
        telemetryWrapperVersion: params.telemetry.wrapperVersion,
        runtimeTelemetry: toJson(params.telemetry),
        tests: toJson(tests),
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
        tests: toJson(tests),
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

export async function backfillWorkflowRunTestsFromGitHub(params: {
  repositoryFullName: string;
  runId: string;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<{
  updated: boolean;
  reason:
    | "updated"
    | "already_has_tests"
    | "repository_not_found"
    | "run_not_found"
    | "installation_not_found"
    | "tests_not_found";
  testCount: number;
}> {
  const repository = await prisma.executionRepository.findUnique({
    where: {
      fullName: params.repositoryFullName,
    },
    select: {
      id: true,
    },
  });

  if (!repository) {
    return { updated: false, reason: "repository_not_found", testCount: 0 };
  }

  const installationId = await getRepositoryInstallationId(params.repositoryFullName);
  if (!installationId) {
    return { updated: false, reason: "installation_not_found", testCount: 0 };
  }

  const workflowRunId = params.runId.split(":")[0];
  const maxAttempts = Math.max(1, params.maxAttempts ?? 4);
  const delayMs = Math.max(0, params.delayMs ?? 7_500);
  let sawRun = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && delayMs > 0) {
      await wait(delayMs * attempt);
    }

    try {
      const existingRun = await prisma.workflowRunSnapshot.findUnique({
        where: {
          externalRunId: params.runId,
        },
        select: {
          repositoryId: true,
          tests: true,
        },
      });

      if (!existingRun || existingRun.repositoryId !== repository.id) {
        continue;
      }

      sawRun = true;

      const existingTests = Array.isArray(existingRun.tests) ? existingRun.tests : [];
      if (existingTests.length > 0) {
        return { updated: false, reason: "already_has_tests", testCount: existingTests.length };
      }

      const tests = await loadTestsFromGitHubWorkflowRun({
        installationId,
        repositoryFullName: params.repositoryFullName,
        workflowRunId,
      });

      if (tests.length === 0) {
        continue;
      }

      await prisma.workflowRunSnapshot.update({
        where: {
          externalRunId: params.runId,
        },
        data: {
          tests: toJson(tests),
        },
      });

      return { updated: true, reason: "updated", testCount: tests.length };
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn("Unable to backfill test signals from GitHub job logs", error);
      }
    }
  }

  return { updated: false, reason: sawRun ? "tests_not_found" : "run_not_found", testCount: 0 };
}
