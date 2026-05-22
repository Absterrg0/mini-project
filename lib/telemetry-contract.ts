import type { RuntimeTelemetry, RuntimeTelemetrySample, WorkflowRun } from "@/app/lib/types";

export const TELEMETRY_SCHEMA_VERSION = "2026-05-11";
export const RUNTIME_ACTION_VERSION = "1.0.0";
export const MAX_RUNTIME_SAMPLES = 720;
export const MAX_ANNOTATIONS = 100;

/** True when persisted JSON clearly came from the ExecForge runtime collector. */
export function isExecForgeEnrichedRuntime(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (o.source === "execforge-wrapper") {
    return true;
  }
  if (
    typeof o.wrapperVersion === "string" &&
    o.wrapperVersion.length > 0 &&
    Array.isArray(o.samples) &&
    o.samples.length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Prefer the DB column, but recover from cases where runtime JSON is enriched
 * while `telemetrySource` still says "github" (e.g. a merge race with webhook ingestion).
 */
export function deriveWorkflowRunTelemetrySource(
  columnSource: string | undefined,
  runtimeTelemetry: unknown,
): "github" | "execforge-wrapper" | undefined {
  if (columnSource === "execforge-wrapper") {
    return "execforge-wrapper";
  }
  if (isExecForgeEnrichedRuntime(runtimeTelemetry)) {
    return "execforge-wrapper";
  }
  if (columnSource === "github") {
    return "github";
  }
  return columnSource as "github" | "execforge-wrapper" | undefined;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface RuntimeTelemetryEnvelope {
  schemaVersion: string;
  collectorVersion: string;
  repositoryFullName: string;
  runId: string;
  runAttempt?: number;
  workflowName?: string;
  branch?: string;
  commitSha?: string;
  telemetry: RuntimeTelemetry;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSample(value: unknown): RuntimeTelemetrySample | null {
  if (!isObject(value)) {
    return null;
  }

  const atMs = asFiniteNumber(value.atMs);
  const cpuPct = asFiniteNumber(value.cpuPct);
  const memoryRssMb = asFiniteNumber(value.memoryRssMb);

  if (atMs === null || cpuPct === null || memoryRssMb === null) {
    return null;
  }

  return {
    atMs,
    cpuPct: Math.max(0, Math.min(100, cpuPct)),
    memoryRssMb: Math.max(0, memoryRssMb),
    diskReadMb: asFiniteNumber(value.diskReadMb) ?? undefined,
    diskWriteMb: asFiniteNumber(value.diskWriteMb) ?? undefined,
    networkRxMb: asFiniteNumber(value.networkRxMb) ?? undefined,
    networkTxMb: asFiniteNumber(value.networkTxMb) ?? undefined,
  };
}

export function validateRuntimeTelemetry(value: unknown): ValidationResult<RuntimeTelemetry> {
  if (!isObject(value)) {
    return { ok: false, error: "Telemetry must be an object." };
  }

  if (value.source !== "github" && value.source !== "execforge-wrapper") {
    return { ok: false, error: "Telemetry source is invalid." };
  }

  if (value.source === "execforge-wrapper" && typeof value.wrapperVersion !== "string") {
    return { ok: false, error: "ExecForge wrapper telemetry requires wrapperVersion." };
  }

  if (!Array.isArray(value.samples)) {
    return { ok: false, error: "Telemetry samples must be an array." };
  }

  if (value.samples.length > MAX_RUNTIME_SAMPLES) {
    return { ok: false, error: `Telemetry sample count exceeds ${MAX_RUNTIME_SAMPLES}.` };
  }

  const samples = value.samples.map(normalizeSample);
  if (samples.some((sample) => !sample)) {
    return { ok: false, error: "Telemetry samples contain invalid numeric fields." };
  }

  const annotations: RuntimeTelemetry["annotations"] = Array.isArray(value.annotations)
    ? value.annotations.slice(0, MAX_ANNOTATIONS).flatMap((annotation) => {
        if (!isObject(annotation) || typeof annotation.message !== "string") {
          return [];
        }

        const level: "info" | "warning" | "error" =
          annotation.level === "error" || annotation.level === "warning" || annotation.level === "info"
            ? annotation.level
            : "info";

        return [
          {
            level,
            message: annotation.message.slice(0, 1000),
            source: typeof annotation.source === "string" ? annotation.source.slice(0, 120) : undefined,
          },
        ];
      })
    : undefined;

  const tests: RuntimeTelemetry["tests"] = Array.isArray(value.tests)
    ? value.tests.flatMap((t) => {
        if (
          !isObject(t) ||
          typeof t.name !== "string" ||
          typeof t.file !== "string"
        ) {
          return [];
        }
        return [
          {
            name: t.name,
            file: t.file,
            durationSec: asFiniteNumber(t.durationSec) ?? 0,
            failed: t.failed === true,
            failureMessage: typeof t.failureMessage === "string" ? t.failureMessage : undefined,
          },
        ];
      })
    : undefined;

  return {
    ok: true,
    value: {
      source: value.source,
      wrapperVersion: typeof value.wrapperVersion === "string" ? value.wrapperVersion : undefined,
      captureStartedAt:
        typeof value.captureStartedAt === "string" ? value.captureStartedAt : undefined,
      captureFinishedAt:
        typeof value.captureFinishedAt === "string" ? value.captureFinishedAt : undefined,
      exitCode: asFiniteNumber(value.exitCode) ?? undefined,
      machine: isObject(value.machine)
        ? {
            os: typeof value.machine.os === "string" ? value.machine.os : undefined,
            arch: typeof value.machine.arch === "string" ? value.machine.arch : undefined,
            runnerName:
              typeof value.machine.runnerName === "string" ? value.machine.runnerName : undefined,
            runnerEnvironment:
              typeof value.machine.runnerEnvironment === "string"
                ? value.machine.runnerEnvironment
                : undefined,
            cpuCount: asFiniteNumber(value.machine.cpuCount) ?? undefined,
            totalMemoryMb: asFiniteNumber(value.machine.totalMemoryMb) ?? undefined,
          }
        : undefined,
      samples: samples as RuntimeTelemetrySample[],
      artifacts: Array.isArray(value.artifacts)
        ? value.artifacts.flatMap((artifact) => {
            if (!isObject(artifact) || typeof artifact.name !== "string" || typeof artifact.path !== "string") {
              return [];
            }
            return [
              {
                name: artifact.name,
                path: artifact.path,
                sizeBytes: asFiniteNumber(artifact.sizeBytes) ?? undefined,
                sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : undefined,
              },
            ];
          })
        : undefined,
      annotations,
      tests,
    },
  };
}

export function validateRuntimeTelemetryEnvelope(
  value: unknown,
): ValidationResult<RuntimeTelemetryEnvelope> {
  if (!isObject(value)) {
    return { ok: false, error: "Payload must be an object." };
  }

  if (typeof value.repositoryFullName !== "string" || !value.repositoryFullName.includes("/")) {
    return { ok: false, error: "repositoryFullName is required." };
  }

  if (typeof value.runId !== "string" || value.runId.length === 0) {
    return { ok: false, error: "runId is required." };
  }

  const telemetry = validateRuntimeTelemetry(value.telemetry);
  if (!telemetry.ok || !telemetry.value) {
    return { ok: false, error: telemetry.error };
  }

  return {
    ok: true,
    value: {
      schemaVersion:
        typeof value.schemaVersion === "string" ? value.schemaVersion : TELEMETRY_SCHEMA_VERSION,
      collectorVersion:
        typeof value.collectorVersion === "string" ? value.collectorVersion : RUNTIME_ACTION_VERSION,
      repositoryFullName: value.repositoryFullName,
      runId: value.runId,
      runAttempt: asFiniteNumber(value.runAttempt) ?? undefined,
      workflowName: typeof value.workflowName === "string" ? value.workflowName : undefined,
      branch: typeof value.branch === "string" ? value.branch : undefined,
      commitSha: typeof value.commitSha === "string" ? value.commitSha : undefined,
      telemetry: telemetry.value,
    },
  };
}

export function validateWorkflowRun(value: unknown): ValidationResult<WorkflowRun> {
  if (!isObject(value)) {
    return { ok: false, error: "Workflow run must be an object." };
  }

  const requiredStrings = ["id", "workflowName", "branch", "commitSha", "startedAt"] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      return { ok: false, error: `Workflow run ${field} is required.` };
    }
  }

  if (value.status !== "success" && value.status !== "failed" && value.status !== "degraded") {
    return { ok: false, error: "Workflow run status is invalid." };
  }

  if (!Array.isArray(value.jobs) || !Array.isArray(value.tests) || !Array.isArray(value.changedFiles)) {
    return { ok: false, error: "Workflow run jobs, tests, and changedFiles must be arrays." };
  }

  if (value.runtimeTelemetry) {
    const telemetry = validateRuntimeTelemetry(value.runtimeTelemetry);
    if (!telemetry.ok) {
      return { ok: false, error: telemetry.error };
    }
  }

  return { ok: true, value: value as unknown as WorkflowRun };
}
