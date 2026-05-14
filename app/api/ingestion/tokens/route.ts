import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createIngestionToken, listIngestionTokens } from "@/lib/ingestion-tokens";

interface CreateTokenBody {
  organizationId?: string;
  repositoryId?: string;
  name?: string;
  expiresAt?: string;
}

async function requireSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function GET(request: Request) {
  const session = await requireSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId") ?? undefined;
  const tokens = await listIngestionTokens({ organizationId });

  return NextResponse.json({ tokens });
}

export async function POST(request: Request) {
  const session = await requireSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateTokenBody;

  if (!body.organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  try {
    const result = await createIngestionToken({
      organizationId: body.organizationId,
      repositoryId: body.repositoryId,
      name: body.name?.trim() || "Runtime ingestion token",
      expiresAt: body.expiresAt,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create token." },
      { status: 400 },
    );
  }
}
