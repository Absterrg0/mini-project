-- CreateTable
CREATE TABLE "AiScanResult" (
    "id" TEXT NOT NULL,
    "runExternalId" TEXT NOT NULL,
    "issues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiScanResult_runExternalId_key" ON "AiScanResult"("runExternalId");

-- AddForeignKey
ALTER TABLE "AiScanResult" ADD CONSTRAINT "AiScanResult_runExternalId_fkey" FOREIGN KEY ("runExternalId") REFERENCES "WorkflowRunSnapshot"("externalRunId") ON DELETE CASCADE ON UPDATE CASCADE;
