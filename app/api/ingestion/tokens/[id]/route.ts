import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revokeIngestionToken } from "@/lib/ingestion-tokens";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await revokeIngestionToken(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unknown token." }, { status: 404 });
  }
}
