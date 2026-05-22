import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getRepositoryInstallationId,
  githubInstallationFetch,
  githubInstallationRequest,
} from "@/lib/github-app";

interface GitHubWorkflowListResponse {
  workflows?: Array<{
    id: number;
    path: string;
    state: string;
  }>;
}

function normalizeWorkflowPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith(".github/workflows/")) return trimmed;
  return `.github/workflows/${trimmed}`;
}

async function resolveWorkflowDispatchId(
  installationId: string | number,
  owner: string,
  repo: string,
  workflowId: string | number,
): Promise<number> {
  if (typeof workflowId === "number") return workflowId;

  const asNumber = Number(workflowId);
  if (Number.isFinite(asNumber) && String(asNumber) === workflowId.trim()) {
    return asNumber;
  }

  const expectedPath = normalizeWorkflowPath(workflowId);
  const basename = expectedPath.split("/").pop() ?? expectedPath;

  const payload = await githubInstallationFetch<GitHubWorkflowListResponse>(
    installationId,
    `/repos/${owner}/${repo}/actions/workflows?per_page=100`,
  );

  const workflows = payload.workflows ?? [];
  const match =
    workflows.find((w) => w.path === expectedPath) ??
    workflows.find((w) => w.path.endsWith(`/${basename}`)) ??
    workflows.find((w) => (w.path.split("/").pop() ?? w.path) === basename);

  if (!match) {
    throw new Error(
      `Workflow "${workflowId}" was not found in ${owner}/${repo}. Expected path ${expectedPath}.`,
    );
  }

  if (match.state === "disabled") {
    throw new Error(`Workflow "${match.path}" is disabled on GitHub.`);
  }

  return match.id;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { repositoryFullName, workflowId, ref } = body as {
    repositoryFullName?: string;
    workflowId?: string | number;
    ref?: string;
  };

  if (!repositoryFullName || !repositoryFullName.includes("/")) {
    return NextResponse.json({ error: "repositoryFullName is required." }, { status: 400 });
  }
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required." }, { status: 400 });
  }

  const installationId = await getRepositoryInstallationId(repositoryFullName);
  if (!installationId) {
    return NextResponse.json(
      { error: "GitHub App not installed for this repository." },
      { status: 503 },
    );
  }

  const [owner, repo] = repositoryFullName.split("/");
  const branch = ref ?? "main";

  try {
    const resolvedWorkflowId = await resolveWorkflowDispatchId(
      installationId,
      owner,
      repo,
      workflowId,
    );

    const result = await githubInstallationRequest<null>(
      installationId,
      `/repos/${owner}/${repo}/actions/workflows/${resolvedWorkflowId}/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: branch }),
      },
    );

    if (result.status === 204 || result.ok) {
      return NextResponse.json({ ok: true, message: "Workflow dispatched." });
    }

    const errMsg =
      result.data &&
      typeof result.data === "object" &&
      "message" in result.data
        ? String((result.data as { message?: unknown }).message)
        : `GitHub returned ${result.status}.`;

    return NextResponse.json({ error: errMsg }, { status: result.status >= 400 ? result.status : 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow dispatch failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
