import { NextResponse } from "next/server";
import { ingestWorkflowRun, recordIngestionEvent } from "@/lib/execution-store";
import { authorizeIngestionRequest } from "@/lib/ingestion-auth";
import { validateWorkflowRun } from "@/lib/telemetry-contract";
import type { IngestionPipeline, RuntimeTelemetry, WorkflowRun } from "@/app/lib/types";
import { isExecForgeOwnedBranch } from "@/lib/branch-guard";

interface RequestBody {
  organizationSlug?: string;
  organizationName?: string;
  repository?: {
    fullName?: string;
    name?: string;
    defaultBranch?: string;
    visibility?: string;
    language?: string;
    team?: string;
    selected?: boolean;
    monthlyCiMinutes?: number;
    monthlyCiSpendUsd?: number;
    p95DurationSec?: number;
    failureRatePct?: number;
    flakeRatePct?: number;
    cacheHitRatePct?: number;
    runnerUtilizationPct?: number;
    telemetryMode?: "github" | "execforge-wrapper";
    telemetryScriptVersion?: string;
    lastIndexedAt?: string;
  };
  run?: WorkflowRun;
  pipeline?: IngestionPipeline;
}

const requiredRepositoryFields = [
  "fullName",
  "name",
  "defaultBranch",
  "visibility",
  "language",
  "team",
  "monthlyCiMinutes",
  "monthlyCiSpendUsd",
  "p95DurationSec",
  "failureRatePct",
  "flakeRatePct",
  "cacheHitRatePct",
  "runnerUtilizationPct",
  "lastIndexedAt",
] as const;

function hasCompleteRepository(
  repository: RequestBody["repository"],
): repository is Required<NonNullable<RequestBody["repository"]>> {
  return Boolean(
    repository &&
      requiredRepositoryFields.every((field) => repository[field] !== undefined && repository[field] !== null),
  );
}

function isRuntimeTelemetry(value: unknown): value is RuntimeTelemetry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const telemetry = value as Partial<RuntimeTelemetry>;
  return (
    (telemetry.source === "github" || telemetry.source === "execforge-wrapper") &&
    Array.isArray(telemetry.samples) &&
    telemetry.samples.every(
      (sample) =>
        typeof sample.atMs === "number" &&
        typeof sample.cpuPct === "number" &&
        typeof sample.memoryRssMb === "number",
    )
  );
}

function hasValidRuntimeTelemetry(run: WorkflowRun): boolean {
  if (!run.runtimeTelemetry) {
    return true;
  }

  return (
    isRuntimeTelemetry(run.runtimeTelemetry) &&
    run.telemetrySource === run.runtimeTelemetry.source &&
    (run.runtimeTelemetry.source === "github" || Boolean(run.runtimeTelemetry.wrapperVersion))
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;
  const authorization = await authorizeIngestionRequest(request, {
    repositoryFullName: body.repository?.fullName,
  });

  if (!authorization.ok) {
    await recordIngestionEvent({
      eventType: "github.workflow_run",
      source: "github-ingestion-api",
      status: "rejected",
      repositoryFullName: body.repository?.fullName,
      externalRunId: body.run?.id,
      error: `auth_${authorization.reason}`,
      payload: body,
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runValidation = validateWorkflowRun(body.run);

  if (
    !body.organizationSlug ||
    !body.organizationName ||
    !hasCompleteRepository(body.repository) ||
    !body.run ||
    !body.pipeline ||
    !runValidation.ok ||
    !hasValidRuntimeTelemetry(body.run)
  ) {
    await recordIngestionEvent({
      eventType: "github.workflow_run",
      source: "github-ingestion-api",
      status: "rejected",
      repositoryFullName: body.repository?.fullName,
      externalRunId: body.run?.id,
      error: runValidation.error ?? "Invalid workflow ingestion payload.",
      payload: body,
    });

    return NextResponse.json(
      {
        error:
          runValidation.error ??
          "Missing organization, complete repository metrics, workflow run, pipeline payload, or valid runtime telemetry.",
      },
      { status: 400 },
    );
  }

  const run = runValidation.value;
  if (!run) {
    return NextResponse.json({ error: "Invalid workflow run." }, { status: 400 });
  }

  // Reject runs from ExecForge's own optimization branches.
  // These PRs trigger CI which would otherwise be re-ingested, creating duplicates
  // and circular metric pollution (e.g. "install telemetry" suggestions on our own PRs).
  if (isExecForgeOwnedBranch(run.branch)) {
    await recordIngestionEvent({
      eventType: "github.workflow_run",
      source: "github-ingestion-api",
      status: "rejected",
      repositoryFullName: body.repository.fullName,
      externalRunId: run.id,
      error: "exec_intel_branch_skipped",
      payload: body,
    });
    // Return 200 so the SDK/webhook doesn't retry — this is intentional skipping.
    return NextResponse.json({ ok: true, skipped: true, reason: "exec_intel_branch" });
  }

  await ingestWorkflowRun({
    organizationSlug: body.organizationSlug,
    organizationName: body.organizationName,
    repository: {
      fullName: body.repository.fullName,
      name: body.repository.name,
      defaultBranch: body.repository.defaultBranch,
      visibility: body.repository.visibility,
      language: body.repository.language,
      team: body.repository.team,
      selected: body.repository.selected ?? true,
      monthlyCiMinutes: body.repository.monthlyCiMinutes,
      monthlyCiSpendUsd: body.repository.monthlyCiSpendUsd,
      p95DurationSec: body.repository.p95DurationSec,
      failureRatePct: body.repository.failureRatePct,
      flakeRatePct: body.repository.flakeRatePct,
      cacheHitRatePct: body.repository.cacheHitRatePct,
      runnerUtilizationPct: body.repository.runnerUtilizationPct,
      telemetryMode: body.repository.telemetryMode ?? body.run.telemetrySource ?? "github",
      telemetryScriptVersion:
        body.repository.telemetryScriptVersion ?? body.run.telemetryWrapperVersion,
      lastIndexedAt: body.repository.lastIndexedAt,
    },
    run,
    pipeline: body.pipeline,
  });

  await recordIngestionEvent({
    eventType: "github.workflow_run",
    source: "github-ingestion-api",
    status: "processed",
    repositoryFullName: body.repository.fullName,
    externalRunId: run.id,
    payload: body,
  });

  return NextResponse.json({ ok: true });
}
