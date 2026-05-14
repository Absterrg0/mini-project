CREATE TABLE "IngestionEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "repositoryFullName" TEXT,
  "externalRunId" TEXT,
  "idempotencyKey" TEXT,
  "eventType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "IngestionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestionEvent_idempotencyKey_key" ON "IngestionEvent"("idempotencyKey");
CREATE INDEX "IngestionEvent_organizationId_receivedAt_idx" ON "IngestionEvent"("organizationId", "receivedAt");
CREATE INDEX "IngestionEvent_repositoryFullName_externalRunId_idx" ON "IngestionEvent"("repositoryFullName", "externalRunId");
CREATE INDEX "IngestionEvent_eventType_status_idx" ON "IngestionEvent"("eventType", "status");

ALTER TABLE "IngestionEvent"
ADD CONSTRAINT "IngestionEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "ExecutionOrganization"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
