-- CreateTable
CREATE TABLE "ExecutionOrganization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "githubAppInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionRepository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "monthlyCiMinutes" INTEGER NOT NULL,
    "monthlyCiSpendUsd" DOUBLE PRECISION NOT NULL,
    "p95DurationSec" INTEGER NOT NULL,
    "failureRatePct" DOUBLE PRECISION NOT NULL,
    "flakeRatePct" DOUBLE PRECISION NOT NULL,
    "cacheHitRatePct" DOUBLE PRECISION NOT NULL,
    "runnerUtilizationPct" DOUBLE PRECISION NOT NULL,
    "lastIndexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunSnapshot" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT,
    "externalRunId" TEXT NOT NULL,
    "workflowName" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "containerLayerReuse" DOUBLE PRECISION NOT NULL,
    "changedFiles" JSONB NOT NULL,
    "jobs" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "cacheHitPct" DOUBLE PRECISION NOT NULL,
    "failureRiskPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationPlanRecord" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "estimatedTimeSavingsPct" DOUBLE PRECISION NOT NULL,
    "estimatedCostSavingsUsdMonthly" DOUBLE PRECISION NOT NULL,
    "branchName" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "guardrails" JSONB NOT NULL,
    "liveCreationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "githubPullRequestNumber" INTEGER,
    "githubPullRequestUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationPlanRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentRiskAssessment" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "runExternalId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rollbackProbability" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionCheckpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "syncCursor" TEXT NOT NULL,
    "eventsProcessed24h" INTEGER NOT NULL,
    "webhookDeliveryPct" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionOrganization_slug_key" ON "ExecutionOrganization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRepository_fullName_key" ON "ExecutionRepository"("fullName");

-- CreateIndex
CREATE INDEX "ExecutionRepository_organizationId_idx" ON "ExecutionRepository"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRunSnapshot_externalRunId_key" ON "WorkflowRunSnapshot"("externalRunId");

-- CreateIndex
CREATE INDEX "WorkflowRunSnapshot_repositoryId_startedAt_idx" ON "WorkflowRunSnapshot"("repositoryId", "startedAt");

-- CreateIndex
CREATE INDEX "TrendSnapshot_organizationId_createdAt_idx" ON "TrendSnapshot"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationPlanRecord_repositoryId_createdAt_idx" ON "OptimizationPlanRecord"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentRiskAssessment_repositoryId_createdAt_idx" ON "DeploymentRiskAssessment"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionCheckpoint_organizationId_createdAt_idx" ON "IngestionCheckpoint"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- AddForeignKey
ALTER TABLE "ExecutionRepository" ADD CONSTRAINT "ExecutionRepository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ExecutionOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunSnapshot" ADD CONSTRAINT "WorkflowRunSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "ExecutionRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ExecutionOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationPlanRecord" ADD CONSTRAINT "OptimizationPlanRecord_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "ExecutionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentRiskAssessment" ADD CONSTRAINT "DeploymentRiskAssessment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "ExecutionRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionCheckpoint" ADD CONSTRAINT "IngestionCheckpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ExecutionOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
