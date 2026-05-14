import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { loadOptimizationContext, loadExecutionSnapshot } from "@/lib/execution-store";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { generateText } from "ai";
import type { WorkflowRun, RepositoryProfile } from "@/app/lib/types";

interface RequestBody {
  repositoryFullName?: string;
  runId?: string;
}

// ─── System prompt ─────────────────────────────────────────────────────────────
// Deliberately comprehensive — the LLM receives all telemetry context and must
// return ONLY structured JSON so parsing is deterministic without a schema library.

const SYSTEM_PROMPT = `You are ExecForge CI Intelligence, an expert CI/CD optimization engine.
You analyze real GitHub Actions workflow telemetry and produce actionable, data-backed optimization recommendations.

## YOUR MISSION
Find issues that the deterministic rule engine (which handles caching, flakiness, and E2E sharding) MISSED.
Think about: infrastructure patterns, security, cost, reliability, developer experience, and workflow design.

## CONSTRAINTS
- Return ONLY valid JSON — no markdown fences, no prose, no explanation outside the JSON.
- Each issue must have a unique id (snake_case), a title (≤80 chars), severity (warning|danger), and a concrete action.
- Every recommendation must be backed by data from the telemetry provided — no generic advice.
- If there is genuinely nothing to add beyond what the rule engine already found, return { "issues": [] }.
- Maximum 6 issues per scan.
- CRITICAL: File paths in filesToChange must be exact. By convention, GitHub Actions workflows are lowercase (e.g., .github/workflows/ci.yml). Never use uppercase CI.yml unless explicitly seen in the changed files.

## RESPONSE FORMAT (strict JSON, no fences)
{
  "issues": [
    {
      "id": "snake_case_unique_id",
      "severity": "warning" | "danger",
      "title": "Short title ≤ 80 chars",
      "detail": "1-3 sentence description backed by specific metric values from the telemetry.",
      "action": {
        "id": "optimization_action_id",
        "title": "PR-ready action title ≤ 80 chars",
        "rationale": "Why this specific change will help, citing the exact data point.",
        "estimatedTimeSavingsPct": 5, // Must be realistically >0 if time is saved (e.g. 5-50)
        "estimatedCostSavingsUsdMonthly": 50, // Must be realistically >0 if cost is saved (e.g. 10-500 based on repo spend)
        "risk": "low" | "medium" | "high",
        "filesToChange": ["path/to/file.yml"]
      }
    }
  ]
}`;

function buildUserPrompt(run: WorkflowRun, allRuns: WorkflowRun[], repository: RepositoryProfile): string {
  const samples = run.runtimeTelemetry?.samples ?? [];
  const avgCpu = samples.length ? samples.reduce((s, x) => s + x.cpuPct, 0) / samples.length : null;
  const peakCpu = samples.length ? Math.max(...samples.map((s) => s.cpuPct)) : null;
  const avgMem = samples.length ? samples.reduce((s, x) => s + x.memoryRssMb, 0) / samples.length : null;
  const peakMem = samples.length ? Math.max(...samples.map((s) => s.memoryRssMb)) : null;

  const avgCacheHit =
    run.jobs.length > 0
      ? run.jobs.reduce((s, j) => s + j.cacheHitRate, 0) / run.jobs.length
      : null;

  const failedRuns = allRuns.filter((r) => r.status === "failed").length;
  const durations = allRuns.map((r) => r.totalDurationSec);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const maxDuration = durations.length ? Math.max(...durations) : 0;

  const stepNames = run.jobs.flatMap((j) => j.steps.map((s) => s.name));
  const slowestSteps = run.jobs
    .flatMap((j) => j.steps.map((s) => ({ job: j.name, step: s.name, durationSec: s.durationSec })))
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, 5);

  const flakyTests = run.tests.filter((t) => t.failures > 0);

  return `## Repository
- Full name: ${repository.fullName}
- Language: ${repository.language}
- Default branch: ${repository.defaultBranch}
- Telemetry mode: ${repository.telemetryMode}
- Monthly CI spend: $${repository.monthlyCiSpendUsd}/mo

## Analyzed Run
- Run ID: ${run.id}
- Workflow: ${run.workflowName}
- Branch: ${run.branch}
- Status: ${run.status}
- Duration: ${run.totalDurationSec}s (average across all runs: ${Math.round(avgDuration)}s, max: ${maxDuration}s)
- Telemetry source: ${run.telemetrySource ?? "github"}
- Jobs: ${run.jobs.length}
- Tests captured: ${run.tests.length}
- Failed tests: ${flakyTests.length}

## Jobs
${run.jobs.map((j) => `- ${j.name}: status=${j.status}, duration=${j.durationSec}s, cacheHitRate=${(j.cacheHitRate * 100).toFixed(0)}%, infraUtilization=${(j.infraUtilization * 100).toFixed(0)}%`).join("\n")}

## Slowest Steps
${slowestSteps.map((s) => `- [${s.job}] ${s.step}: ${s.durationSec}s`).join("\n") || "No step data"}

## Runtime Telemetry (${samples.length} samples)
${samples.length > 0 ? `- Avg CPU: ${avgCpu?.toFixed(1)}%, Peak CPU: ${peakCpu?.toFixed(1)}%
- Avg Memory: ${avgMem?.toFixed(0)} MB, Peak Memory: ${peakMem?.toFixed(0)} MB
- Exit code: ${run.runtimeTelemetry?.exitCode ?? "unknown"}
- Machine: ${JSON.stringify(run.runtimeTelemetry?.machine ?? {})}` : "No runtime telemetry (webhook-only run)"}

## Cache Health
- Average cache hit rate: ${avgCacheHit !== null ? (avgCacheHit * 100).toFixed(0) + "%" : "unknown"}

## Fleet Context (${allRuns.length} total runs)
- Failed runs: ${failedRuns} (${Math.round((failedRuns / Math.max(1, allRuns.length)) * 100)}%)
- Enriched runs (with ExecForge wrapper): ${allRuns.filter((r) => r.telemetrySource === "execforge-wrapper").length}

## Changed Files (this run)
(Use exact paths from here if modifying existing files)
${run.changedFiles.slice(0, 20).join("\n") || "No changed files captured"}

## Step Names (for pattern detection)
${stepNames.slice(0, 30).join(", ") || "None"}

Now analyze this data and return your JSON response. Only include issues that are NOT already covered by:
- Cache optimization (actions/cache@v4)
- E2E sharding (Playwright matrix)
- Docker multi-stage builds
- Flaky test quarantine
Focus on infrastructure, security, reliability, and DX issues you can uniquely identify from this data.`;
}

function buildPromptWithExisting(run: WorkflowRun, allRuns: WorkflowRun[], repository: RepositoryProfile, existingIssues: any[]): string {
  let prompt = buildUserPrompt(run, allRuns, repository);
  if (existingIssues && existingIssues.length > 0) {
    const existingTitles = existingIssues.map((i) => i.title).join(", ");
    prompt += `\n\n## DO NOT SUGGEST THESE ISSUES AGAIN:\nWe have already identified these issues. You must find NEW issues that do not overlap with:\n- ${existingTitles}`;
  }
  return prompt;
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
  const context = await loadOptimizationContext({
    repositoryFullName: body.repositoryFullName,
    runId: body.runId,
  });

  if (!context) {
    return NextResponse.json(
      { error: "Unknown repository or workflow run." },
      { status: 400 },
    );
  }

  const { repository, run } = context;
  const { workflowRuns } = await loadExecutionSnapshot();
  const allRepoRuns = workflowRuns.filter((r) => r.repositoryId === repository.id);

  try {
    const { prisma } = await import("@/lib/prisma");

    const existingScan = await prisma.aiScanResult.findUnique({
      where: { runExternalId: run.id }
    });
    const existingIssues = existingScan?.issues ? (existingScan.issues as any[]) : [];

    const model = buildAIModel(aiSettings);
    const userPrompt = buildPromptWithExisting(run, allRepoRuns, repository, existingIssues);

    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.2,
    });

    // Strip any accidental markdown fences the model might have added
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: { issues: unknown[] };
    try {
      parsed = JSON.parse(cleaned) as { issues: unknown[] };
    } catch {
      console.error("[ai-scan] Invalid JSON from model:", cleaned.slice(0, 200));
      return NextResponse.json({ error: "AI model returned malformed response. Try again." }, { status: 500 });
    }

    if (!Array.isArray(parsed?.issues)) {
      return NextResponse.json({ issues: [] });
    }

    // Flag them so the frontend knows they came from AI
    const issuesWithFlag = parsed.issues.map((i: any) => ({
      ...i,
      action: {
        ...(i.action || {}),
        isAiGenerated: true,
      }
    }));

    // Deduplicate against existing issues
    const existingTitles = new Set(existingIssues.map((i) => i.title.toLowerCase()));
    const existingIds = new Set(existingIssues.map((i) => i.id));
    const newUniqueIssues = issuesWithFlag.filter(
      (i) => !existingTitles.has(i.title.toLowerCase()) && !existingIds.has(i.id)
    );

    const combinedIssues = [...existingIssues, ...newUniqueIssues];

    await prisma.aiScanResult.upsert({
      where: { runExternalId: run.id },
      create: { runExternalId: run.id, issues: combinedIssues as any },
      update: { issues: combinedIssues as any },
    });

    revalidatePath("/dashboard/pr-agent");

    return NextResponse.json({ issues: newUniqueIssues });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ai-scan] Error:", msg);
    return NextResponse.json({ error: `AI scan failed: ${msg}` }, { status: 500 });
  }
}
