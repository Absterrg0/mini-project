import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRepositoryInstallationId, githubInstallationFetch } from "@/lib/github-app";

interface GitHubWorkflowListResponse {
  workflows?: Array<{
    id: number;
    name: string;
    path: string;
    state: string;
    created_at: string;
    updated_at: string;
    html_url: string;
  }>;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const repositoryFullName = searchParams.get("repositoryFullName");

  if (!repositoryFullName || !repositoryFullName.includes("/")) {
    return NextResponse.json({ error: "repositoryFullName is required." }, { status: 400 });
  }

  const installationId = await getRepositoryInstallationId(repositoryFullName);

  if (!installationId) {
    return NextResponse.json(
      { error: "Install the GitHub App for this repository before importing workflows." },
      { status: 503 },
    );
  }

  try {
    const payload = await githubInstallationFetch<GitHubWorkflowListResponse>(
      installationId,
      `/repos/${repositoryFullName}/actions/workflows`,
    );

    return NextResponse.json({
      repositoryFullName,
      workflows:
        payload.workflows?.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          path: workflow.path,
          state: workflow.state,
          createdAt: workflow.created_at,
          updatedAt: workflow.updated_at,
          url: workflow.html_url,
        })) ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "GitHub workflow import failed through the installed GitHub App.",
      },
      { status: 502 },
    );
  }
}
