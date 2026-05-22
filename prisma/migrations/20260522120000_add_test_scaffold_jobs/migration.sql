CREATE TABLE "TestScaffoldJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "flavor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "prUrl" TEXT,
    "branchName" TEXT,
    "files" JSONB,
    "draftOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TestScaffoldJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestScaffoldJob_userId_createdAt_idx" ON "TestScaffoldJob"("userId", "createdAt");
CREATE INDEX "TestScaffoldJob_status_createdAt_idx" ON "TestScaffoldJob"("status", "createdAt");
