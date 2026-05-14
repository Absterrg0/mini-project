import { NextResponse } from "next/server";
import { attachRuntimeTelemetry, recordIngestionEvent } from "@/lib/execution-store";
import { authorizeIngestionRequest } from "@/lib/ingestion-auth";
import { validateRuntimeTelemetryEnvelope } from "@/lib/telemetry-contract";

interface IngestionEventRequest {
  eventType?: string;
  source?: string;
  payload?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json()) as IngestionEventRequest;
  const eventType = body.eventType ?? "unknown";
  const source = body.source ?? "external";
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;

  if (eventType === "runtime.telemetry") {
    const envelope = validateRuntimeTelemetryEnvelope(body.payload);

    if (!envelope.ok || !envelope.value) {
      await recordIngestionEvent({
        eventType,
        source,
        status: "rejected",
        idempotencyKey,
        error: envelope.error ?? "Invalid runtime telemetry event payload.",
        payload: body.payload,
      });

      return NextResponse.json(
        { error: envelope.error ?? "Invalid runtime telemetry event payload." },
        { status: 400 },
      );
    }

    const authorization = await authorizeIngestionRequest(request, {
      repositoryFullName: envelope.value.repositoryFullName,
    });

    if (!authorization.ok) {
      await recordIngestionEvent({
        eventType,
        source,
        status: "rejected",
        repositoryFullName: envelope.value.repositoryFullName,
        externalRunId: envelope.value.runId,
        idempotencyKey,
        error: `auth_${authorization.reason}`,
        payload: envelope.value,
      });

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await attachRuntimeTelemetry({
      repositoryFullName: envelope.value.repositoryFullName,
      runId: envelope.value.runId,
      telemetry: envelope.value.telemetry,
      organizationId: authorization.type === "token" ? authorization.organizationId : undefined,
    });

    await recordIngestionEvent({
      eventType,
      source,
      status: result.attached ? "processed" : "rejected",
      repositoryFullName: envelope.value.repositoryFullName,
      externalRunId: envelope.value.runId,
      idempotencyKey,
      error: result.reason ?? undefined,
      payload: envelope.value,
    });

    if (!result.attached) {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  }

  const authorization = await authorizeIngestionRequest(request);
  if (!authorization.ok) {
    await recordIngestionEvent({
      eventType,
      source,
      status: "rejected",
      idempotencyKey,
      error: `auth_${authorization.reason}`,
      payload: body.payload ?? body,
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await recordIngestionEvent({
    eventType,
    source,
    status: "accepted",
    idempotencyKey,
    payload: body.payload ?? body,
  });

  return NextResponse.json({ ok: true, queued: true });
}
