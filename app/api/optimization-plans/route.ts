import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { loadExistingPlans } from "@/lib/execution-store";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  const runId = searchParams.get("runId");

  if (!repo || !runId) {
    return NextResponse.json({ error: "repo and runId are required" }, { status: 400 });
  }

  const plans = await loadExistingPlans({ repositoryFullName: repo, runId });
  return NextResponse.json({ plans });
}
