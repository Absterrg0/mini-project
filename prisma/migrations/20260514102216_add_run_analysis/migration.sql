-- CreateTable
CREATE TABLE "RunAnalysis" (
    "id" TEXT NOT NULL,
    "runExternalId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunAnalysis_runExternalId_key" ON "RunAnalysis"("runExternalId");

-- AddForeignKey
ALTER TABLE "RunAnalysis" ADD CONSTRAINT "RunAnalysis_runExternalId_fkey" FOREIGN KEY ("runExternalId") REFERENCES "WorkflowRunSnapshot"("externalRunId") ON DELETE CASCADE ON UPDATE CASCADE;
