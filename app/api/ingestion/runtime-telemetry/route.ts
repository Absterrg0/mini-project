import { NextResponse } from "next/server";
import { attachRuntimeTelemetry, recordIngestionEvent } from "@/lib/execution-store";
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

  const authorization = await authorizeIngestionRequest(request, {
    repositoryFullName: envelope.value.repositoryFullName,
  });

  if (!authorization.ok) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: envelope.value.repositoryFullName,
      externalRunId: envelope.value.runId,
      idempotencyKey,
      error: `auth_${authorization.reason}`,
      payload: envelope.value,
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Skip enriched telemetry from ExecForge's own optimization branches.
  if (isExecForgeOwnedBranch(envelope.value.branch ?? "")) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: envelope.value.repositoryFullName,
      externalRunId: envelope.value.runId,
      idempotencyKey,
      error: "exec_intel_branch_skipped",
      payload: envelope.value,
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "exec_intel_branch" });
  }

  const result = await attachRuntimeTelemetry({
    repositoryFullName: envelope.value.repositoryFullName,
    runId: envelope.value.runId,
    workflowName: envelope.value.workflowName,
    branch: envelope.value.branch,
    commitSha: envelope.value.commitSha,
    telemetry: envelope.value.telemetry,
    organizationId: authorization.type === "token" ? authorization.organizationId : undefined,
  });

  if (!result.attached) {
    await recordIngestionEvent({
      eventType: "runtime.telemetry",
      source: "execforge-runtime-action",
      status: "rejected",
      repositoryFullName: envelope.value.repositoryFullName,
      externalRunId: envelope.value.runId,
      idempotencyKey,
      error: result.reason ?? undefined,
      payload: envelope.value,
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
    repositoryFullName: envelope.value.repositoryFullName,
    externalRunId: envelope.value.runId,
    idempotencyKey,
    payload: envelope.value,
  });

  return NextResponse.json({ ok: true });
}
