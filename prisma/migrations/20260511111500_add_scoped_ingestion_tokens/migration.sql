CREATE TABLE "IngestionToken" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "name" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "lastFour" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "IngestionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestionToken_tokenHash_key" ON "IngestionToken"("tokenHash");
CREATE INDEX "IngestionToken_organizationId_status_idx" ON "IngestionToken"("organizationId", "status");
CREATE INDEX "IngestionToken_repositoryId_status_idx" ON "IngestionToken"("repositoryId", "status");

ALTER TABLE "IngestionToken"
ADD CONSTRAINT "IngestionToken_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "ExecutionOrganization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IngestionToken"
ADD CONSTRAINT "IngestionToken_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "ExecutionRepository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
