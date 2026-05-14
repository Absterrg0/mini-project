import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { loadOptimizationContext, loadExecutionSnapshot } from "@/lib/execution-store";
import { COOKIE_NAME, type AISettings, buildAIModel } from "@/lib/ai-provider";
import { generateText } from "ai";
import { getCleanErrorMessage } from "@/lib/api-errors";
import type { WorkflowRun, RepositoryProfile } from "@/app/lib/types";

interface RequestBody {
  repositoryFullName?: string;
  runId?: string;
}

// ─── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ExecForge CI Intelligence, a senior DevOps observability expert.
Your job is to write a clear, insightful narrative analysis of a single CI workflow run, explaining exactly WHAT happened and WHY — like a postmortem or performance review written by an expert engineer.

## YOUR MISSION
Explain the run's performance profile in natural language:
- Why was CPU high or low at specific phases?
- Why did memory spike or hold steady?
- What caused slow steps or jobs?
- Were there anomalies vs. typical runs?
- What does this reveal about the build, test, or deploy process?

## STYLE GUIDELINES
- Write in short, crisp paragraphs. Use headers to organize sections.
- Be specific — cite actual numbers (e.g. "CPU peaked at 87% during the webpack build step").
- Be causal — explain the "why" not just the "what".
- Use markdown formatting: ## headers, **bold** for key metrics, bullet lists where appropriate.
- Write for a senior engineer audience. No fluff, no hedging, no generic advice.
- If data is sparse (no runtime telemetry), say so clearly and focus on what IS available (job durations, steps, status).
- Do NOT repeat back every metric verbatim — synthesize and explain.

## STRUCTURE
Use this structure (omit sections if no data):
## Run Summary
## CPU & Memory Analysis
## Job & Step Breakdown
## Anomalies & Patterns
## Key Takeaway

Keep the total response under 600 words. Use markdown only — no JSON.`;

function buildAnalysisPrompt(run: WorkflowRun, allRuns: WorkflowRun[], repository: RepositoryProfile): string {
  const rt = run.runtimeTelemetry;
  const samples = rt?.samples ?? [];
  const cpuSamples = samples.map((s) => s.cpuPct);
  const memSamples = samples.map((s) => s.memoryRssMb);
  const avgCpu = cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null;
  const peakCpu = cpuSamples.length ? Math.max(...cpuSamples) : null;
  const minCpu = cpuSamples.length ? Math.min(...cpuSamples) : null;
  const avgMem = memSamples.length ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length : null;
  const peakMem = memSamples.length ? Math.max(...memSamples) : null;

  // Build CPU timeline description
  let cpuTimeline = "No samples.";
  if (cpuSamples.length >= 2) {
    const buckets = 6;
    const step = Math.floor(cpuSamples.length / buckets);
    const phases = [];
    for (let i = 0; i < buckets; i++) {
      const slice = cpuSamples.slice(i * step, (i + 1) * step);
      const avg = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
      phases.push(`phase${i + 1}=${avg.toFixed(1)}%`);
    }
    cpuTimeline = phases.join(" → ");
  }

  const durations = allRuns.map((r) => r.totalDurationSec);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const vsAvg = run.totalDurationSec - avgDuration;

  const slowestSteps = run.jobs
    .flatMap((j) => j.steps.map((s) => ({ job: j.name, step: s.name, durationSec: s.durationSec })))
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, 5);

  const failedJobs = run.jobs.filter((j) => j.status === "failed");
  const flakyJobs = run.jobs.filter((j) => j.status === "flaky");

  return `## Repository
- Name: ${repository.fullName}
- Language: ${repository.language}
- Monthly CI spend: $${repository.monthlyCiSpendUsd}/mo
- P95 duration: ${repository.p95DurationSec}s

## This Run
- ID: ${run.id}
- Workflow: ${run.workflowName}
- Branch: ${run.branch}
- Status: ${run.status}
- Started: ${run.startedAt}
- Duration: ${run.totalDurationSec}s (fleet avg: ${Math.round(avgDuration)}s, delta: ${vsAvg > 0 ? "+" : ""}${Math.round(vsAvg)}s)
- Telemetry source: ${run.telemetrySource ?? "github"}
- Jobs: ${run.jobs.length} | Failed: ${failedJobs.length} | Flaky: ${flakyJobs.length}
- Tests: ${run.tests.length} | Failing tests: ${run.tests.filter((t) => t.failures > 0).length}

## Runtime Telemetry (${samples.length} samples)
${samples.length > 0 ? `- Avg CPU: ${avgCpu?.toFixed(1)}%, Peak CPU: ${peakCpu?.toFixed(1)}%, Min CPU: ${minCpu?.toFixed(1)}%
- CPU timeline (6 phases): ${cpuTimeline}
- Avg Memory: ${avgMem?.toFixed(0)} MB, Peak Memory: ${peakMem?.toFixed(0)} MB
- Exit code: ${rt?.exitCode ?? "unknown"}
- Machine: ${JSON.stringify(rt?.machine ?? {})}
- Capture window: ${rt?.captureStartedAt ?? "?"} → ${rt?.captureFinishedAt ?? "?"}` : "No runtime telemetry (standard webhook-only run — no process-level data available)."}

## Jobs
${run.jobs.map((j) => `- ${j.name}: status=${j.status}, duration=${j.durationSec}s, cache=${(j.cacheHitRate * 100).toFixed(0)}%, infra=${(j.infraUtilization * 100).toFixed(0)}%, runner=${j.runner}`).join("\n") || "None"}

## Slowest Steps
${slowestSteps.map((s) => `- [${s.job}] ${s.step}: ${s.durationSec}s`).join("\n") || "No step data"}

## Changed Files (${run.changedFiles.length})
${run.changedFiles.slice(0, 15).join("\n") || "None captured"}

## Fleet Context (${allRuns.length} runs)
- Failed runs: ${allRuns.filter((r) => r.status === "failed").length}
- Enriched runs: ${allRuns.filter((r) => r.telemetrySource === "execforge-wrapper").length}
- Duration range: ${Math.min(...durations)}s – ${Math.max(...durations)}s

Now write your narrative analysis. Be insightful and specific.`;
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

// ─── GET — fetch persisted analysis ────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");
  const record = await prisma.runAnalysis.findUnique({
    where: { runExternalId: runId },
  });

  if (!record) {
    return NextResponse.json({ analysis: null });
  }

  return NextResponse.json({
    analysis: {
      markdown: record.markdown,
      model: record.model,
      createdAt: record.createdAt.toISOString(),
    },
  });
}

// ─── POST — run AI analysis ─────────────────────────────────────────────────────

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
    const model = buildAIModel(aiSettings);
    const userPrompt = buildAnalysisPrompt(run, allRepoRuns, repository);

    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
    });

    const markdown = text.trim();
    const modelName = `${aiSettings.provider}/${aiSettings.model}`;

    const { prisma } = await import("@/lib/prisma");
    const record = await prisma.runAnalysis.upsert({
      where: { runExternalId: run.id },
      create: {
        runExternalId: run.id,
        markdown,
        model: modelName,
      },
      update: {
        markdown,
        model: modelName,
      },
    });

    revalidateTag("execution-snapshot", "max");

    return NextResponse.json({
      analysis: {
        markdown: record.markdown,
        model: record.model,
        createdAt: record.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const msg = getCleanErrorMessage(error, "Analysis failed to process due to an unexpected error.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
