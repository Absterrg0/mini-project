import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type IngestionTokenScope = "organization" | "repository";

export interface IngestionTokenSummary {
  id: string;
  organizationId: string;
  repositoryId?: string;
  name: string;
  scope: IngestionTokenScope;
  tokenPrefix: string;
  lastFour: string;
  status: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IngestionTokenValidation {
  ok: boolean;
  reason?: "missing" | "invalid" | "expired" | "revoked" | "scope_mismatch";
  token?: {
    id: string;
    organizationId: string;
    repositoryId?: string;
    scope: IngestionTokenScope;
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function compareHashes(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function mapToken(token: {
  id: string;
  organizationId: string;
  repositoryId: string | null;
  name: string;
  scope: string;
  tokenPrefix: string;
  lastFour: string;
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): IngestionTokenSummary {
  return {
    id: token.id,
    organizationId: token.organizationId,
    repositoryId: token.repositoryId ?? undefined,
    name: token.name,
    scope: token.scope as IngestionTokenScope,
    tokenPrefix: token.tokenPrefix,
    lastFour: token.lastFour,
    status: token.status,
    expiresAt: token.expiresAt?.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString(),
    createdAt: token.createdAt.toISOString(),
    revokedAt: token.revokedAt?.toISOString(),
  };
}

export async function listIngestionTokens(params: {
  organizationId?: string;
}): Promise<IngestionTokenSummary[]> {
  const tokens = await prisma.ingestionToken.findMany({
    where: {
      organizationId: params.organizationId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return tokens.map(mapToken);
}

export async function createIngestionToken(params: {
  organizationId: string;
  repositoryId?: string;
  name: string;
  expiresAt?: string;
}): Promise<{ token: string; summary: IngestionTokenSummary }> {
  const organization = await prisma.executionOrganization.findUnique({
    where: {
      id: params.organizationId,
    },
  });

  if (!organization) {
    throw new Error("Unknown organization.");
  }

  if (params.repositoryId) {
    const repository = await prisma.executionRepository.findUnique({
      where: {
        id: params.repositoryId,
      },
    });

    if (!repository || repository.organizationId !== params.organizationId) {
      throw new Error("Unknown repository for organization.");
    }
  }

  const token = `exf_${randomBytes(32).toString("base64url")}`;
  const created = await prisma.ingestionToken.create({
    data: {
      organizationId: params.organizationId,
      repositoryId: params.repositoryId,
      name: params.name,
      scope: params.repositoryId ? "repository" : "organization",
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 8),
      lastFour: token.slice(-4),
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
    },
  });

  return {
    token,
    summary: mapToken(created),
  };
}

export async function revokeIngestionToken(id: string) {
  await prisma.ingestionToken.update({
    where: {
      id,
    },
    data: {
      status: "revoked",
      revokedAt: new Date(),
    },
  });
}

export async function validateIngestionToken(params: {
  token?: string | null;
  repositoryFullName?: string;
}): Promise<IngestionTokenValidation> {
  if (!params.token) {
    return { ok: false, reason: "missing" };
  }

  const tokenHash = hashToken(params.token);
  const candidates = await prisma.ingestionToken.findMany({
    where: {
      tokenPrefix: params.token.slice(0, 8),
    },
  });

  const candidate = candidates.find((item) => compareHashes(item.tokenHash, tokenHash));

  if (!candidate) {
    return { ok: false, reason: "invalid" };
  }

  if (candidate.status !== "active" || candidate.revokedAt) {
    return { ok: false, reason: "revoked" };
  }

  if (candidate.expiresAt && candidate.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (params.repositoryFullName) {
    const repository = await prisma.executionRepository.findUnique({
      where: {
        fullName: params.repositoryFullName,
      },
    });

    if (!repository) {
      return { ok: false, reason: "scope_mismatch" };
    }

    const matchesOrg = candidate.organizationId === repository.organizationId;
    const matchesRepository =
      candidate.scope === "organization" || candidate.repositoryId === repository.id;

    if (!matchesOrg || !matchesRepository) {
      return { ok: false, reason: "scope_mismatch" };
    }
  }

  await prisma.ingestionToken.update({
    where: {
      id: candidate.id,
    },
    data: {
      lastUsedAt: new Date(),
    },
  });

  return {
    ok: true,
    token: {
      id: candidate.id,
      organizationId: candidate.organizationId,
      repositoryId: candidate.repositoryId ?? undefined,
      scope: candidate.scope as IngestionTokenScope,
    },
  };
}
