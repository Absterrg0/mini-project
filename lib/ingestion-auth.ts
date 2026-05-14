import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { validateIngestionToken } from "@/lib/ingestion-tokens";

export type IngestionAuthResult =
  | {
      ok: true;
      type: "session";
    }
  | {
      ok: true;
      type: "token";
      tokenId: string;
      organizationId: string;
      repositoryId?: string;
    }
  | {
      ok: false;
      reason: string;
    };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

export async function authorizeIngestionRequest(
  request: Request,
  params: {
    repositoryFullName?: string;
    allowSession?: boolean;
  } = {},
): Promise<IngestionAuthResult> {
  const token = bearerToken(request);

  if (token) {
    const result = await validateIngestionToken({
      token,
      repositoryFullName: params.repositoryFullName,
    });

    if (!result.ok || !result.token) {
      return { ok: false, reason: result.reason ?? "invalid" };
    }

    return {
      ok: true,
      type: "token",
      tokenId: result.token.id,
      organizationId: result.token.organizationId,
      repositoryId: result.token.repositoryId,
    };
  }

  if (params.allowSession !== false) {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (session) {
      return { ok: true, type: "session" };
    }
  }

  return { ok: false, reason: "missing" };
}
