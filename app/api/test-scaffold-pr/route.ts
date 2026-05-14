import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { getCleanErrorMessage } from "@/lib/api-errors";
import { getRepositoryInstallationId, githubInstallationRequest } from "@/lib/github-app";
import { generateText } from "ai";
import { parseJsonWithRepair } from "@/lib/json-model-parse";
import { loadExecutionSnapshot } from "@/lib/execution-store";

export type TestScaffoldFlavor =
  | "flaky"     // intermittently failing tests with retry logic
  | "failing"   // deterministically failing tests
  | "slow"      // tests with artificial timing issues
  | "e2e"       // Playwright/Cypress-style integration tests
  | "unit";     // pure unit tests with mocks

interface RequestBody {
  repositoryFullName?: string;
  flavor?: TestScaffoldFlavor;
}

interface GeneratedFile {
  path: string;
  content: string;
  summary: string;
}

interface ScaffoldResult {
  prUrl: string | null;
  branchName: string | null;
  files: GeneratedFile[];
  draftOnly: boolean;
}

const FLAVOR_DESCRIPTIONS: Record<TestScaffoldFlavor, string> = {
  flaky: "intermittently failing tests (random failures, timing-dependent assertions, retry-based tests) that simulate real CI flakiness patterns",
  failing: "deterministically failing tests that catch real bugs — tests which assert incorrect expected values or call functions with wrong arguments",
  slow: "slow tests with artificial delays, large data processing loops, and sequential I/O that artificially inflate CI duration",
  e2e: "end-to-end integration tests using Playwright conventions — page navigation, form submissions, API assertions, and screenshot comparisons",
  unit: "comprehensive unit tests with deep mocking, edge case coverage, boundary testing, and assertion-heavy specs",
};

function getAISettings(cookieHeader: string): AISettings | null {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")) as AISettings;
  } catch {
    return null;
  }
}

async function githubRepoFetch<T>(
  installationId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return githubInstallationRequest<T>(installationId, path, init);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieHeader = (await headers()).get("cookie") ?? "";
  const aiSettings = getAISettings(cookieHeader);
  if (!aiSettings) {
    return NextResponse.json(
      { error: "No AI model configured. Go to Settings → AI Model to set your API key." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as RequestBody;
  const { repositoryFullName, flavor = "flaky" } = body;

  if (!repositoryFullName) {
    return NextResponse.json({ error: "repositoryFullName is required." }, { status: 400 });
  }

  if (!FLAVOR_DESCRIPTIONS[flavor as TestScaffoldFlavor]) {
    return NextResponse.json({ error: "Invalid test flavor." }, { status: 400 });
  }

  // Load repo context
  const { organizations } = await loadExecutionSnapshot();
  const repo = organizations.flatMap((o) => o.repositories).find((r) => r.fullName === repositoryFullName);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found." }, { status: 400 });
  }

  const installationId = await getRepositoryInstallationId(repositoryFullName);

  try {
    // Generate test files with AI
    const model = buildAIModel(aiSettings);
    const [owner, repoName] = repositoryFullName.split("/");

    const { text } = await generateText({
      model,
      temperature: 0.3,
      system: `You are ExecForge Test Scaffold. You generate realistic, well-structured test files that are useful for demonstrating CI test intelligence dashboards.
Generate tests that look authentic — use real library imports appropriate for the repository's language (${repo.language}), realistic test names, and meaningful assertions.
CRITICAL: Return ONLY valid JSON, no markdown fences, no prose outside JSON.`,
      prompt: `Generate 2-3 test files for the repository "${repositoryFullName}" (language: ${repo.language}).
These tests should be: ${FLAVOR_DESCRIPTIONS[flavor as TestScaffoldFlavor]}.

Requirements:
- Use the testing framework most common for ${repo.language} (Jest for JS/TS, pytest for Python, RSpec for Ruby, JUnit for Java, Go testing for Go, etc.)
- File paths must be realistic for the language (e.g. __tests__/auth.test.ts, tests/test_auth.py)
- Test names must be descriptive and follow the framework's conventions
- Each file must be complete and syntactically valid
- For flaky tests: use Math.random() or Date.now() % N to introduce random failures
- For failing tests: write tests that are logically incorrect (assert wrong values)
- For slow tests: add setTimeout/sleep/large loops that take 3-10 seconds
- For e2e tests: use page navigation, selectors, form fills with Playwright/Cypress syntax
- For unit tests: deep mock dependencies, test edge cases, boundary conditions

Return JSON:
{
  "files": [
    {
      "path": "path/to/test/file.ext",
      "content": "full file content as a string",
      "summary": "one-line description of what this file tests"
    }
  ]
}`,
    });

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let files: GeneratedFile[];
    try {
      const parsed = parseJsonWithRepair(cleaned) as { files?: unknown };
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
        throw new Error("No files returned from AI.");
      }
      files = (parsed.files as any[]).map((f) => ({
        path: String(f.path),
        content: String(f.content),
        summary: String(f.summary ?? ""),
      }));
    } catch (e) {
      console.error("[test-scaffold-pr] Failed to parse AI output:", e);
      return NextResponse.json({ error: "AI returned a malformed response. Please try again." }, { status: 500 });
    }

    // If no GitHub App, return draft-only (just the files, no actual PR)
    if (!installationId) {
      return NextResponse.json({
        draftOnly: true,
        files,
        branchName: null,
        prUrl: null,
      } as ScaffoldResult);
    }

    // Push a real PR via GitHub App
    const baseBranchRef = await githubRepoFetch<{ object?: { sha?: string } }>(
      installationId,
      `/repos/${owner}/${repoName}/git/ref/heads/${repo.defaultBranch}`,
    );

    if (!baseBranchRef.ok || !baseBranchRef.data?.object?.sha) {
      return NextResponse.json({ error: "Could not read the base branch from GitHub." }, { status: 502 });
    }

    const branchSuffix = Date.now().toString(36);
    const branchName = `exec-intel/scaffold-${flavor}-tests-${branchSuffix}`;

    const createRef = await githubRepoFetch(
      installationId,
      `/repos/${owner}/${repoName}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseBranchRef.data.object.sha,
        }),
      },
    );

    if (!createRef.ok && createRef.status !== 422) {
      return NextResponse.json({ error: "Failed to create branch on GitHub." }, { status: 502 });
    }

    // Commit all files
    for (const file of files) {
      const encodedPath = file.path
        .split("/")
        .map((p) => encodeURIComponent(p))
        .join("/");

      const existing = await githubRepoFetch<{ sha?: string }>(
        installationId,
        `/repos/${owner}/${repoName}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
      );

      const commitBody: Record<string, unknown> = {
        message: `[exec-intel] Add scaffold ${flavor} test: ${file.path}`,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        branch: branchName,
      };
      if (existing.ok && existing.data?.sha) {
        commitBody.sha = existing.data.sha;
      }

      await githubRepoFetch(
        installationId,
        `/repos/${owner}/${repoName}/contents/${encodedPath}`,
        { method: "PUT", body: JSON.stringify(commitBody) },
      );
    }

    // Open the PR
    const flavorLabel =
      flavor === "flaky" ? "⚡ Flaky"
      : flavor === "failing" ? "🔴 Failing"
      : flavor === "slow" ? "🐢 Slow"
      : flavor === "e2e" ? "🌐 E2E"
      : "✅ Unit";

    const pull = await githubRepoFetch<{ html_url?: string; number?: number }>(
      installationId,
      `/repos/${owner}/${repoName}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: `[exec-intel] ${flavorLabel} test scaffold for CI intelligence demo`,
          body: [
            "## 🧪 ExecForge Test Scaffold",
            "",
            `This PR was generated by **ExecForge CI Intelligence** to demonstrate the **${flavorLabel}** test detection capabilities.`,
            "",
            "### Files added",
            ...files.map((f) => `- \`${f.path}\` — ${f.summary}`),
            "",
            "### Why these tests?",
            FLAVOR_DESCRIPTIONS[flavor as TestScaffoldFlavor],
            "",
            "### What happens next",
            "1. Merge this PR to your main branch",
            "2. Push a new commit to trigger CI",
            "3. ExecForge will detect and surface the test patterns in the **Tests** dashboard",
            "",
            "---",
            "*Generated by ExecForge · [View Dashboard](/dashboard/tests)*",
          ].join("\n"),
          head: branchName,
          base: repo.defaultBranch,
          draft: false,
        }),
      },
    );

    if (!pull.ok || !pull.data?.html_url) {
      // Branch was created + files committed, but PR failed — return files at least
      return NextResponse.json({
        draftOnly: true,
        files,
        branchName,
        prUrl: null,
      } as ScaffoldResult);
    }

    return NextResponse.json({
      draftOnly: false,
      files,
      branchName,
      prUrl: pull.data.html_url,
    } as ScaffoldResult);
  } catch (error) {
    const msg = getCleanErrorMessage(error, "Failed to generate test scaffold.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
