import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import {
  backfillWorkflowRunTestsFromGitHub,
  ingestWorkflowRun,
  recordIngestionEvent,
} from "@/lib/execution-store";
import {
  GitHubAppConfigurationError,
  type GitHubWebhookPayload,
  disconnectGitHubInstallation,
  removeGitHubRepository,
  syncInstallationRepositories,
  upsertGitHubRepository,
  verifyGitHubWebhookSignature,
  workflowRunFromGitHub,
} from "@/lib/github-app";
import { getCleanErrorMessage } from "@/lib/api-errors";

function deliveryId(request: Request): string {
  return request.headers.get("x-github-delivery") ?? randomUUID();
}

async function recordWebhook(params: {
  event: string;
  delivery: string;
  status: "accepted" | "processed" | "rejected";
  repositoryFullName?: string;
  externalRunId?: string;
  error?: string;
  payload: unknown;
}) {
  try {
    await recordIngestionEvent({
      eventType: `github.${params.event}`,
      source: "github-app-webhook",
      status: params.status,
      repositoryFullName: params.repositoryFullName,
      externalRunId: params.externalRunId,
      idempotencyKey: `github-webhook:${params.delivery}`,
      error: params.error,
      payload: params.payload,
    });
  } catch (error) {
    console.error("Failed to record GitHub webhook ingestion event", error);
  }
}

async function processWebhook(event: string, payload: GitHubWebhookPayload) {
  const installationId = payload.installation?.id;

  if (event === "installation" && installationId) {
    if (payload.action === "deleted") {
      await disconnectGitHubInstallation(installationId);
      return { processed: true };
    }
    const repositories = await syncInstallationRepositories(installationId);
    return { processed: true, repositoryCount: repositories.length };
  }

  if (event === "installation_repositories" && installationId) {
    for (const repository of payload.repositories_added ?? []) {
      await upsertGitHubRepository({
        installationId,
        repository,
        selected: true,
        installation: payload.installation,
      });
    }
    for (const repository of payload.repositories_removed ?? []) {
      await removeGitHubRepository(repository.full_name);
    }
    return {
      processed: true,
      repositoriesAdded: payload.repositories_added?.length ?? 0,
      repositoriesRemoved: payload.repositories_removed?.length ?? 0,
    };
  }

  if (event === "repository" && installationId && payload.repository) {
    if (payload.action === "deleted") {
      await removeGitHubRepository(payload.repository.full_name);
    } else {
      await upsertGitHubRepository({
        installationId,
        repository: payload.repository,
        selected: true,
        installation: payload.installation,
      });
    }
    return { processed: true };
  }

  if (event === "workflow_run" && installationId && payload.repository && payload.workflow_run) {
    const run = await workflowRunFromGitHub({
      installationId,
      repository: payload.repository,
      workflowRun: payload.workflow_run,
    });
    const org = {
      slug: payload.repository.owner.login.toLowerCase(),
      name: payload.repository.owner.login,
    };

    await ingestWorkflowRun({
      organizationSlug: org.slug,
      organizationName: org.name,
      githubAppInstallationId: String(installationId),
      repository: {
        fullName: payload.repository.full_name,
        name: payload.repository.name,
        defaultBranch: payload.repository.default_branch ?? "main",
        visibility: payload.repository.private ? "private" : "public",
        language: payload.repository.language ?? "Unknown",
        team: payload.repository.owner.login,
        selected: true,
        monthlyCiMinutes: 0,
        monthlyCiSpendUsd: 0,
        p95DurationSec: run.totalDurationSec,
        failureRatePct: run.status === "failed" ? 100 : 0,
        flakeRatePct: run.status === "degraded" ? 100 : 0,
        cacheHitRatePct: 0,
        runnerUtilizationPct: 0,
        telemetryMode: "github",
        lastIndexedAt: new Date().toISOString(),
      },
      run,
      pipeline: {
        organizationId: "",
        syncCursor: `workflow-run-${run.id}`,
        eventsProcessed24h: 1,
        webhookDeliveryPct: 100,
        checks: [
          {
            id: `github-webhook-${run.id}`,
            label: "GitHub workflow webhook",
            status: "healthy",
            detail: "Workflow run was verified and ingested through the GitHub App webhook.",
            latencyMs: 0,
          },
        ],
      },
    });

    revalidateTag("execution-snapshot", { expire: 0 });

    // When the workflow_run completes, also try a synchronous backfill as a
    // safety net in case the workflow_job event did not arrive (e.g. unsubscribed).
    // Use a very short retry window here since the job should already be done.
    if (payload.action === "completed" && run.tests.length === 0) {
      try {
        const backfill = await backfillWorkflowRunTestsFromGitHub({
          repositoryFullName: payload.repository!.full_name,
          runId: run.id,
          maxAttempts: 2,
          delayMs: 2_000,
        });

        await recordIngestionEvent({
          eventType: "github.workflow_run_test_backfill",
          source: "github-app-webhook",
          status: backfill.updated ? "processed" : "rejected",
          repositoryFullName: payload.repository!.full_name,
          externalRunId: run.id,
          idempotencyKey: `github-workflow-run-test-backfill:${payload.repository!.full_name}:${run.id}`,
          error: backfill.updated ? undefined : backfill.reason,
          payload: backfill,
        });

        if (backfill.updated) {
          revalidateTag("execution-snapshot", { expire: 0 });
        }
      } catch (error) {
        console.warn("Unable to run synchronous test-signal backfill for workflow_run", error);
      }
    }

    return { processed: true, runId: run.id };
  }

  if (
    event === "workflow_job" &&
    payload.action === "completed" &&
    installationId &&
    payload.repository &&
    payload.workflow_job?.run_id
  ) {
    const workflowJob = payload.workflow_job;
    const repositoryFullName = payload.repository.full_name;
    const runAttempt = workflowJob.run_attempt ?? payload.workflow_run?.run_attempt ?? 1;
    const runId = `${workflowJob.run_id}:${runAttempt}`;

    console.log(`[execforge:webhook] workflow_job completed \u2014 repo=${repositoryFullName} runId=${runId} jobId=${workflowJob.id} jobName="${workflowJob.name}" conclusion=${workflowJob.conclusion}`);

    // The workflow_job completed event fires only after the job is fully done —
    // GitHub guarantees log files are finalized at this point. Run the test
    // backfill synchronously with a single attempt so we don't need after() at all.
    try {
      const backfill = await backfillWorkflowRunTestsFromGitHub({
        repositoryFullName,
        runId,
        maxAttempts: 1,
        delayMs: 0,
      });

      console.log(`[execforge:webhook] workflow_job backfill result: ${JSON.stringify(backfill)}`);

      await recordIngestionEvent({
        eventType: "github.workflow_job_test_backfill",
        source: "github-app-webhook",
        status: backfill.updated ? "processed" : "rejected",
        repositoryFullName,
        externalRunId: runId,
        idempotencyKey: `github-workflow-job-test-backfill:${repositoryFullName}:${runId}`,
        error: backfill.updated ? undefined : backfill.reason,
        payload: {
          ...backfill,
          jobId: workflowJob.id,
          jobName: workflowJob.name,
          conclusion: workflowJob.conclusion,
        },
      });

      if (backfill.updated) {
        revalidateTag("execution-snapshot", { expire: 0 });
      }
    } catch (error) {
      console.warn("Unable to backfill test signals from workflow_job completed event", error);
    }

    return { processed: true, runId, jobId: workflowJob.id };
  }

  return { processed: false };
}

export async function POST(request: Request) {
  const body = await request.text();
  const event = request.headers.get("x-github-event") ?? "unknown";
  const delivery = deliveryId(request);
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGitHubWebhookSignature({ body, signature })) {
    await recordWebhook({
      event,
      delivery,
      status: "rejected",
      error: "invalid_signature",
      payload: { event, delivery },
    });
    return NextResponse.json({ error: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body) as GitHubWebhookPayload;
    const result = await processWebhook(event, payload);
    await recordWebhook({
      event,
      delivery,
      status: "processed",
      repositoryFullName: payload.repository?.full_name,
      externalRunId:
        payload.workflow_run ? String(payload.workflow_run.id) :
        payload.workflow_job?.run_id ? String(payload.workflow_job.run_id) :
        undefined,
      payload: {
        action: payload.action,
        installationId: payload.installation?.id,
        result,
      },
    });

    return NextResponse.json({ ok: true, event, delivery, ...result });
  } catch (error) {
    await recordWebhook({
      event,
      delivery,
      status: "rejected",
      error: error instanceof Error ? error.message : "Webhook processing failed.",
      payload: { event, delivery },
    });

    if (error instanceof GitHubAppConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const detail = getCleanErrorMessage(error, "Webhook processing failed.");
    return NextResponse.json(
      { error: detail },
      { status: 502 },
    );
  }
}
