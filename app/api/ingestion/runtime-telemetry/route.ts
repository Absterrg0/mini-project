import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  attachRuntimeTelemetry,
  recordIngestionEvent,
} from "@/lib/execution-store";
import { authorizeIngestionRequest } from "@/lib/ingestion-auth";
import { validateRuntimeTelemetryEnvelope } from "@/lib/telemetry-contract";
import { isExecForgeOwnedBranch } from "@/lib/branch-guard";


export async function POST(request: Request) {
  const body = await request.json();
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const envelope = validateRuntimeTelemetryEnvelope(body);

  if (!envelope.ok || !envelope.value) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      idempotencyKey,
      error: envelope.error ?? "Invalid runtime telemetry payload.",
      payload: body,
    });

    return NextResponse.json(
      { error: envelope.error ?? "Missing repository, run id, or valid ExecForge runtime telemetry." },
      { status: 400 },
    );
  }

  const telemetryEnvelope = envelope.value;

  const authorization = await authorizeIngestionRequest(request, {
    repositoryFullName: telemetryEnvelope.repositoryFullName,
  });

  if (!authorization.ok) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: telemetryEnvelope.repositoryFullName,
      externalRunId: telemetryEnvelope.runId,
      idempotencyKey,
      error: `auth_${authorization.reason}`,
      payload: telemetryEnvelope,
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Skip enriched telemetry from ExecForge's own optimization branches.
  if (isExecForgeOwnedBranch(telemetryEnvelope.branch ?? "")) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: telemetryEnvelope.repositoryFullName,
      externalRunId: telemetryEnvelope.runId,
      idempotencyKey,
      error: "exec_intel_branch_skipped",
      payload: telemetryEnvelope,
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "exec_intel_branch" });
  }

  const result = await attachRuntimeTelemetry({
    repositoryFullName: telemetryEnvelope.repositoryFullName,
    runId: telemetryEnvelope.runId,
    workflowName: telemetryEnvelope.workflowName,
    branch: telemetryEnvelope.branch,
    commitSha: telemetryEnvelope.commitSha,
    telemetry: telemetryEnvelope.telemetry,
    organizationId: authorization.type === "token" ? authorization.organizationId : undefined,
  });

  if (!result.attached) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: telemetryEnvelope.repositoryFullName,
      externalRunId: telemetryEnvelope.runId,
      idempotencyKey,
      error: result.reason ?? undefined,
      payload: telemetryEnvelope,
    });

    return NextResponse.json(
      { error: result.reason === "repository_not_found" ? "Unknown repository." : "Unknown run." },
      { status: 404 },
    );
  }

  await recordIngestionEvent({
    eventType: "runtime.telemetry",
    source: "execforge-runtime-action",
    status: "processed",
    repositoryFullName: telemetryEnvelope.repositoryFullName,
    externalRunId: telemetryEnvelope.runId,
    idempotencyKey,
    payload: telemetryEnvelope,
  });

  revalidateTag("execution-snapshot", { expire: 0 });

  return NextResponse.json({ ok: true });
}
