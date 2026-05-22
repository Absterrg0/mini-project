import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientWithRetry;
  prismaPool?: Pool;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to initialize Prisma.");
}

function getDatabasePoolMax() {
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 1);
  return Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 1;
}

const pool =
  globalForPrisma.prismaPool ??
  (() => {
    const nextPool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 30_000,
      max: getDatabasePoolMax(),
    });

    nextPool.on("error", (error) => {
      console.error("Unexpected Prisma database pool error", error);
    });

    return nextPool;
  })();

const adapter = new PrismaPg(pool);

const transientDatabaseErrorCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "57P01",
  "57P02",
  "57P03",
]);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isTransientDatabaseError(error: unknown) {
  const code = getErrorCode(error);
  return code ? transientDatabaseErrorCodes.has(code) : false;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === 7) break;
      await wait(250 * 2 ** attempt);
    }
  }

  throw lastError;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn"] : ["error"],
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return withDatabaseRetry(() => query(args));
        },
      },
    },
  });
}

type PrismaClientWithRetry = ReturnType<typeof createPrismaClient>;

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaPool = pool;
}
