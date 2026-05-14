ALTER TABLE "ExecutionRepository"
ADD COLUMN "telemetryMode" TEXT NOT NULL DEFAULT 'github',
ADD COLUMN "telemetryScriptVersion" TEXT;

ALTER TABLE "WorkflowRunSnapshot"
ADD COLUMN "telemetrySource" TEXT NOT NULL DEFAULT 'github',
ADD COLUMN "telemetryWrapperVersion" TEXT,
ADD COLUMN "runtimeTelemetry" JSONB;
