import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildOptimizationPullRequestPlan } from "@/app/lib/pr-agent";
import { deriveOptimizations } from "@/app/lib/analysis";
import { loadExecutionSnapshot, loadOptimizationContext, recordOptimizationPlan, loadExistingPlans } from "@/lib/execution-store";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { generateText } from "ai";
import { getRepositoryInstallationId, githubInstallationRequest } from "@/lib/github-app";
import type { OptimizationPullRequestPlan, OptimizationAction } from "@/app/lib/types";

interface RequestBody {
  actionId?: string;
  repositoryFullName?: string;
  runId?: string;
  mode?: "draft" | "create";
  userFeedback?: string;
}

interface GitHubContentResponse {
  sha?: string;
}

async function githubRepoFetch<T>(
  installationId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return githubInstallationRequest<T>(installationId, path, init);
}

async function createGitHubPullRequest(installationId: string, plan: OptimizationPullRequestPlan) {
  const [owner, repo] = plan.repositoryFullName.split("/");
  const refPath = `/repos/${owner}/${repo}/git/ref/heads/${plan.baseBranch}`;
  const baseRef = await githubRepoFetch<{ object?: { sha?: string } }>(installationId, refPath);

  if (!baseRef.ok || !baseRef.data?.object?.sha) {
    throw new Error(`Unable to read base branch ${plan.baseBranch}.`);
  }

  const branchRef = `refs/heads/${plan.branchName}`;
  const createRef = await githubRepoFetch(installationId, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: branchRef,
      sha: baseRef.data.object.sha,
    }),
  });

  if (!createRef.ok && createRef.status !== 422) {
    throw new Error(`Unable to create branch ${plan.branchName}.`);
  }

  for (const file of plan.files) {
    const encodedPath = file.path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    // Try to get existing SHA (needed for updating an existing file).
    // If the file doesn't exist yet, sha will be undefined and GitHub
    // will treat the PUT as a create — that's fine.
    const existing = await githubRepoFetch<GitHubContentResponse>(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(plan.branchName)}`,
    );

    const body: Record<string, unknown> = {
      message: `${plan.title}: ${file.path}`,
      content: Buffer.from(file.content, "utf8").toString("base64"),
      branch: plan.branchName,
    };
    // Only include sha when the file already exists; omitting it creates the file.
    if (existing.ok && existing.data?.sha) {
      body.sha = existing.data.sha;
    }

    const update = await githubRepoFetch<{ message?: string; errors?: unknown[] }>(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodedPath}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );

    if (!update.ok) {
      const detail = (update.data as { message?: string } | null)?.message ?? "unknown";
      throw new Error(`Unable to commit ${file.path}: ${detail}`);
    }
  }

  const pull = await githubRepoFetch<{ html_url?: string; number?: number }>(
    installationId,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: plan.title,
        body: plan.body,
        head: plan.branchName,
        base: plan.baseBranch,
        draft: plan.risk !== "low",
      }),
    },
  );

  if (!pull.ok || !pull.data?.html_url) {
    throw new Error("Unable to open pull request.");
  }

  return {
    number: pull.data.number,
    url: pull.data.html_url,
  };
}

function getAISettings(cookieHeader: string): AISettings | null {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")) as AISettings;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as RequestBody;
  const context = await loadOptimizationContext({
    repositoryFullName: body.repositoryFullName,
    runId: body.runId,
  });

  if (!context) {
    return NextResponse.json(
      { error: "Unknown ingested repository or workflow run." },
      { status: 400 },
    );
  }

  const { repository, run } = context;

  // Load all runs for this repo to give deriveOptimizations full context
  const { workflowRuns } = await loadExecutionSnapshot();
  const allRepoRuns = workflowRuns.filter((r) => r.repositoryId === repository.id);

  let action: OptimizationAction | undefined = deriveOptimizations(run, allRepoRuns).find((item) => item.id === body.actionId);

  if (!action && Array.isArray(run.aiScanResult)) {
    const aiIssue = run.aiScanResult.find((issue: any) => issue.action?.id === body.actionId);
    if (aiIssue && aiIssue.action) {
      action = {
        ...aiIssue.action,
        isAiGenerated: true,
      } as OptimizationAction;
    }
  }

  if (!action) {
    return NextResponse.json(
      { error: "Unknown optimization action for the selected workflow run." },
      { status: 400 },
    );
  }

  // Sanitize paths to fix older AI scans that may have generated "CI.yml" or wrong paths
  action.filesToChange = action.filesToChange.map(f => 
    f.toLowerCase().includes(".github/workflows/ci.yml") || f.toLowerCase() === "ci.yml"
      ? ".github/workflows/ci.yml" 
      : f
  );

  let plan: OptimizationPullRequestPlan;
  const installationId = await getRepositoryInstallationId(repository.fullName);
  const liveCreationEnabled = Boolean(installationId);

  const existingPlans = await loadExistingPlans({
    repositoryFullName: repository.fullName,
    runId: run.id,
  });
  const existingPlanRecord = existingPlans.find((p) => p.actionId === body.actionId);

  if (existingPlanRecord?.plan && !body.userFeedback) {
    plan = existingPlanRecord.plan;
  } else if (action.isAiGenerated) {
    // 1. Fetch old content for the files if possible
    const oldFiles: Record<string, string> = {};
    if (installationId) {
      const [owner, repoName] = repository.fullName.split("/");
      await Promise.all(
        action.filesToChange.map(async (originalPath: string) => {
          let path = originalPath;
          const realPath = run.changedFiles.find(p => p.toLowerCase().endsWith(path.toLowerCase())) 
                        || run.changedFiles.find(p => p.toLowerCase() === path.toLowerCase());
          if (realPath) {
            path = realPath;
          }

          let encodedPath = path.split("/").map(encodeURIComponent).join("/");
          let existing = await githubRepoFetch<{ content?: string }>(
            installationId,
            `/repos/${owner}/${repoName}/contents/${encodedPath}?ref=${encodeURIComponent(repository.defaultBranch)}`
          );

          if (!existing.ok && path !== path.toLowerCase()) {
            path = path.toLowerCase();
            encodedPath = path.split("/").map(encodeURIComponent).join("/");
            existing = await githubRepoFetch<{ content?: string }>(
              installationId,
              `/repos/${owner}/${repoName}/contents/${encodedPath}?ref=${encodeURIComponent(repository.defaultBranch)}`
            );
          }

          if (existing.ok && existing.data?.content) {
            oldFiles[path] = Buffer.from(existing.data.content, "base64").toString("utf8");
          }
        })
      );
    }

    // 2. Prepare the AI prompt
    const cookieHeader = (await headers()).get("cookie") ?? "";
    const aiSettings = getAISettings(cookieHeader);
    if (!aiSettings) {
      return NextResponse.json({ error: "No AI model configured. Go to Settings to set it." }, { status: 400 });
    }

    const model = buildAIModel(aiSettings);
    
    const fileContext = Object.entries(oldFiles).map(([path, content]) => `
--- ${path} ---
${content}
`).join("\n");

    const prompt = `You are ExecForge PR Agent. You must implement the following optimization action.
Title: ${action.title}
Rationale: ${action.rationale}
Files to change: ${action.filesToChange.join(", ")}

Here is the context of the run:
Repository: ${repository.fullName}
Workflow Name: ${run.workflowName}
Branch: ${run.branch}

${fileContext ? `Existing file contents:\n${fileContext}` : `No existing file contents available. Please synthesize the required files.`}

CRITICAL: When generating file paths, DO NOT use uppercase for workflow file names (e.g. use .github/workflows/ci.yml, NOT .github/workflows/CI.yml). Always use lowercase for workflow files.

CRITICAL: Prefer the start/finish pattern: \`- uses: Absterrg0/execforge-runtime/start@v1\` at the top of steps and \`- uses: Absterrg0/execforge-runtime/finish@v1\` (with \`if: always()\`) at the bottom so the entire job is instrumented — never use \`npx @execforge/runtime run\` across steps.
Only use \`mode: start\` / \`mode: finish\` explicit inputs if boundaries are required for an unusual workflow shape.

${body.userFeedback ? `WARNING: The user rejected the previous draft and provided the following feedback:
"${body.userFeedback}"
You MUST incorporate this feedback to correct your solution.` : ``}

Return ONLY valid JSON in this format:
{
  "files": [
    {
      "path": "path/to/file",
      "operation": "create" | "update",
      "summary": "Short summary of the change",
      "content": "Full file content as a string"
    }
  ]
}`;

    try {
      const { text } = await generateText({
        model,
        system: "You are an expert CI/CD engineer. Output strictly valid JSON without markdown fences.",
        prompt,
        temperature: 0.1,
      });

      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned) as { files: any[] };
      const safeRunId = run.id.replace(/[^a-zA-Z0-9._-]/g, "-");
      const branchName = `exec-intel/${action.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 44)}-${safeRunId}`;
      
      plan = {
        actionId: action.id,
        repositoryFullName: repository.fullName,
        branchName,
        baseBranch: repository.defaultBranch,
        title: `[exec-intel] ${action.title}`,
        body: `## Summary\n\nThis PR was generated by Execution Intelligence from workflow run ${run.id}.\n\n## Why\n\n${action.rationale}\n\n## Expected impact\n\n- ${action.estimatedTimeSavingsPct}% faster CI path\n- $${action.estimatedCostSavingsUsdMonthly}/mo estimated CI savings\n- Risk level: ${action.risk}\n\n## Files changed\n\n${parsed.files.map(f => `- ${f.path}: ${f.summary}`).join("\n")}\n\n## Guardrails\n\n- Generated from observed workflow telemetry.\n- Human review is required before merge.\n`,
        risk: action.risk,
        estimatedTimeSavingsPct: action.estimatedTimeSavingsPct,
        estimatedCostSavingsUsdMonthly: action.estimatedCostSavingsUsdMonthly,
        files: parsed.files.map(f => {
          let matchedPath = Object.keys(oldFiles).find(p => p.toLowerCase() === f.path.toLowerCase()) 
                         || Object.keys(oldFiles).find(p => p.toLowerCase().endsWith(f.path.toLowerCase()));
          
          if (!matchedPath) {
            matchedPath = run.changedFiles.find(p => p.toLowerCase() === f.path.toLowerCase()) 
                       || run.changedFiles.find(p => p.toLowerCase().endsWith(f.path.toLowerCase()));
          }
          
          matchedPath = matchedPath || f.path;
          // TypeScript: narrow to string so .toLowerCase() is always valid
          const resolvedPath: string = matchedPath ?? f.path;
          const normalizedPath =
            resolvedPath.toLowerCase() === ".github/workflows/ci.yml"
              ? ".github/workflows/ci.yml"
              : resolvedPath;
          
          const oldContent = oldFiles[normalizedPath];
          
          return {
            ...f,
            path: normalizedPath,
            operation: oldContent ? "update" : f.operation,
            oldContent,
          };
        }),
        guardrails: [
          "Generated from observed workflow telemetry.",
          "Human review is required before merge.",
        ],
      };
    } catch (error) {
      console.error("Failed to parse AI generated PR plan", error);
      return NextResponse.json({ error: "AI failed to generate a valid PR plan." }, { status: 500 });
    }
  } else {
    plan = buildOptimizationPullRequestPlan({ action, repository, run });

    // Fetch old content for proper diffs in the UI if possible
    if (installationId) {
      const [owner, repoName] = repository.fullName.split("/");
      await Promise.all(
        plan.files.map(async (file) => {
          if (file.operation === "update") {
            const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
            const existing = await githubRepoFetch<{ content?: string }>(
              installationId,
              `/repos/${owner}/${repoName}/contents/${encodedPath}?ref=${encodeURIComponent(plan.baseBranch)}`
            );
            if (existing.ok && existing.data?.content) {
              file.oldContent = Buffer.from(existing.data.content, "base64").toString("utf8");
            }
          }
        })
      );
    }
  }

  // Live creation logic follows...

  if (body.mode !== "create" || !liveCreationEnabled || action.risk === "high") {
    void recordOptimizationPlan({
      repositoryFullName: repository.fullName,
      runId: run.id,
      plan,
      liveCreationEnabled,
    }).catch((error) => {
      console.error("Failed to persist draft optimization plan", error);
    });

    return NextResponse.json({
      mode: "draft",
      liveCreationEnabled,
      message: liveCreationEnabled
        ? "Draft PR plan generated. Submit in create mode to open it on GitHub."
        : "Draft PR plan generated. Install the GitHub App for this repository for live PR creation.",
      plan,
    });
  }

  try {
    if (!installationId) {
      throw new Error("GitHub App installation is required for live PR creation.");
    }
    const pullRequest = await createGitHubPullRequest(installationId, plan);
    void recordOptimizationPlan({
      repositoryFullName: repository.fullName,
      runId: run.id,
      plan,
      liveCreationEnabled,
      pullRequest,
    }).catch((error) => {
      console.error("Failed to persist created optimization plan", error);
    });

    return NextResponse.json({
      mode: "created",
      plan,
      pullRequest,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create pull request.",
        mode: "draft",
        plan,
      },
      { status: 502 },
    );
  }
}
