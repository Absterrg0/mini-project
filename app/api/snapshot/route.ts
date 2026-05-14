import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { loadExecutionSnapshot } from "@/lib/execution-store";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const snapshot = await loadExecutionSnapshot();
  return NextResponse.json(snapshot);
}
