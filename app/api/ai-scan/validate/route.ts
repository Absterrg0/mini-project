import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { loadOptimizationContext, loadExecutionSnapshot } from "@/lib/execution-store";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { generateText } from "ai";
import { getCleanErrorMessage } from "@/lib/api-errors";
import { parseJsonWithRepair } from "@/lib/json-model-parse";
import type { WorkflowRun, RepositoryProfile } from "@/app/lib/types";

interface RequestBody {
  repositoryFullName?: string;
  runId?: string;
  issueId?: string;
}

interface ValidateResult {
  valid: boolean;
  reason: string;
}

const VALIDATE_SYSTEM_PROMPT = `You are ExecForge CI Intelligence. Your task is to determine whether a previously-identified CI optimization issue is still relevant given the CURRENT workflow telemetry.

## INSTRUCTIONS
- Analyze the current run telemetry carefully.
- Determine if the issue described is still present, or if it has been resolved (e.g. the file was changed, the pattern was fixed, the metric improved).
- Be generous: if there is any doubt and the evidence points even weakly to the issue persisting, mark it as valid.
- Return ONLY valid JSON — no markdown fences, no prose outside the JSON.

## RESPONSE FORMAT (strict JSON, no fences)
{
  "valid": true | false,
  "reason": "1-2 sentence explanation of why this issue is still present or has been resolved, citing specific telemetry values."
}`;

function buildValidatePrompt(
  issue: { id: string; title: string; detail: string; action: { rationale: string; filesToChange: string[] } },
  run: WorkflowRun,
  allRuns: WorkflowRun[],
  repository: RepositoryProfile,
): string {
  const samples = run.runtimeTelemetry?.samples ?? [];
  const avgCpu = samples.length ? samples.reduce((s, x) => s + x.cpuPct, 0) / samples.length : null;
  const avgMem = samples.length ? samples.reduce((s, x) => s + x.memoryRssMb, 0) / samples.length : null;
  const avgCacheHit =
    run.jobs.length > 0 ? run.jobs.reduce((s, j) => s + j.cacheHitRate, 0) / run.jobs.length : null;
  const durations = allRuns.map((r) => r.totalDurationSec);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);

  return `## Repository
- Full name: ${repository.fullName}
- Language: ${repository.language}
- Default branch: ${repository.defaultBranch}
- Monthly CI spend: $${repository.monthlyCiSpendUsd}/mo

## CURRENT Run (latest telemetry — this is what matters)
- Run ID: ${run.id}
- Commit SHA: ${run.commitSha}
- Workflow: ${run.workflowName}
- Branch: ${run.branch}
- Status: ${run.status}
- Duration: ${run.totalDurationSec}s (fleet average: ${Math.round(avgDuration)}s)
- Jobs: ${run.jobs.length}
- Tests captured: ${run.tests.length}

## Jobs
${run.jobs.map((j) => `- ${j.name}: status=${j.status}, duration=${j.durationSec}s, cacheHitRate=${(j.cacheHitRate * 100).toFixed(0)}%, infraUtilization=${(j.infraUtilization * 100).toFixed(0)}%`).join("\n")}

## Runtime Telemetry (${samples.length} samples)
${samples.length > 0 ? `- Avg CPU: ${avgCpu?.toFixed(1)}%, Avg Memory: ${avgMem?.toFixed(0)} MB` : "No runtime telemetry (webhook-only run)"}

## Cache Health
- Average cache hit rate: ${avgCacheHit !== null ? (avgCacheHit * 100).toFixed(0) + "%" : "unknown"}

## Changed Files (this run)
${run.changedFiles.slice(0, 20).join("\n") || "No changed files captured"}

---

## Issue to Validate
- ID: ${issue.id}
- Title: ${issue.title}
- Detail: ${issue.detail}
- Rationale: ${issue.action.rationale}
- Files it targets: ${issue.action.filesToChange.join(", ") || "none specified"}

Based on the CURRENT telemetry above, is this issue still present and actionable? Return your JSON response.`;
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

  if (!body.repositoryFullName || !body.runId || !body.issueId) {
    return NextResponse.json({ error: "Missing required fields: repositoryFullName, runId, issueId" }, { status: 400 });
  }

  const context = await loadOptimizationContext({
    repositoryFullName: body.repositoryFullName,
    runId: body.runId,
  });

  if (!context) {
    return NextResponse.json({ error: "Unknown repository or workflow run." }, { status: 400 });
  }

  const { repository, run } = context;
  const { workflowRuns } = await loadExecutionSnapshot();
  const allRepoRuns = workflowRuns.filter((r) => r.repositoryId === repository.id);

  try {
    const { prisma } = await import("@/lib/prisma");

    // Load the persisted scan result to find the issue
    const existingScan = await prisma.aiScanResult.findUnique({
      where: { runExternalId: run.id },
    });

    if (!existingScan) {
      return NextResponse.json({ error: "No AI scan result found for this run." }, { status: 404 });
    }

    const issues = Array.isArray(existingScan.issues) ? (existingScan.issues as any[]) : [];
    const issue = issues.find((i: any) => String(i.id) === String(body.issueId) || String(i.action?.id) === String(body.issueId));

    if (!issue) {
      return NextResponse.json({ error: "Issue not found in scan result." }, { status: 404 });
    }

    const issueForPrompt = {
      id: String(issue.id ?? body.issueId),
      title: String(issue.title ?? ""),
      detail: String(issue.detail ?? ""),
      action: {
        rationale: String(issue.action?.rationale ?? ""),
        filesToChange: Array.isArray(issue.action?.filesToChange) ? issue.action.filesToChange : [],
      },
    };

    const model = buildAIModel(aiSettings);
    const prompt = buildValidatePrompt(issueForPrompt, run, allRepoRuns, repository);

    const { text } = await generateText({
      model,
      system: VALIDATE_SYSTEM_PROMPT,
      prompt,
      temperature: 0.1,
    });

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let result: ValidateResult;
    try {
      const parsed = parseJsonWithRepair(cleaned) as { valid?: unknown; reason?: unknown };
      result = {
        valid: parsed.valid === true,
        reason: String(parsed.reason ?? "No reason provided."),
      };
    } catch (e) {
      console.error("[ai-scan/validate] Invalid JSON from model:", cleaned.slice(0, 400), e);
      // Default to valid on parse failure — don't silently discard issues
      result = { valid: true, reason: "Could not parse validation response; treating as still valid." };
    }

    // If invalid, remove the issue from the persisted scan result
    if (!result.valid) {
      const updatedIssues = issues.filter(
        (i: any) => String(i.id) !== String(body.issueId) && String(i.action?.id) !== String(body.issueId),
      );

      await prisma.aiScanResult.update({
        where: { runExternalId: run.id },
        data: { issues: updatedIssues as any },
      });

      revalidateTag("execution-snapshot", "max");
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = getCleanErrorMessage(error, "Validation failed to process.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
