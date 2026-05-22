import { createHmac, sign } from "node:crypto";
import type { JobExecution, StepExecution, TestSignal, WorkflowRun } from "@/app/lib/types";
import { prisma } from "@/lib/prisma";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE = "https://api.github.com";

interface GitHubOwner {
  login: string;
  type?: string;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubOwner;
  default_branch?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
}

interface GitHubInstallationRepositoriesResponse {
  repositories?: GitHubRepository[];
}

interface GitHubInstallationResponse {
  id: number;
  account?: GitHubOwner;
  html_url?: string | null;
  repository_selection?: "all" | "selected" | null;
}

interface GitHubWorkflowJob {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  runner_group_name?: string | null;
  labels?: string[];
  steps?: Array<{
    name: string;
    status?: string | null;
    conclusion?: string | null;
    number?: number;
    started_at?: string | null;
    completed_at?: string | null;
  }>;
}

interface GitHubWorkflowJobsResponse {
  jobs?: GitHubWorkflowJob[];
}



export interface GitHubWorkflowRunPayload {
  id: number;
  name?: string | null;
  display_title?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  status?: string | null;
  conclusion?: string | null;
  run_started_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  run_attempt?: number | null;
}

export interface GitHubWebhookPayload {
  action?: string;
  installation?: {
    id?: number;
    account?: GitHubOwner;
    html_url?: string | null;
    repository_selection?: "all" | "selected" | null;
  };
  repositories?: GitHubRepository[];
  repositories_added?: GitHubRepository[];
  repositories_removed?: GitHubRepository[];
  repository?: GitHubRepository;
  workflow_run?: GitHubWorkflowRunPayload;
  workflow_job?: {
    id?: number;
    run_id?: number;
    run_attempt?: number | null;
    name?: string | null;
    status?: string | null;
    conclusion?: string | null;
  };
}

export class GitHubAppConfigurationError extends Error {}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new GitHubAppConfigurationError(`${name} is required for GitHub App access.`);
  }
  return value;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export function createGitHubAppJwt(now = Math.floor(Date.now() / 1000)): string {
  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKey = normalizePrivateKey(requiredEnv("GITHUB_APP_PRIVATE_KEY"));
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );
  const body = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), privateKey);
  return `${body}.${base64Url(signature)}`;
}

export function verifyGitHubWebhookSignature(params: {
  body: string;
  signature: string | null;
}): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !params.signature?.startsWith("sha256=")) {
    return false;
  }

  const digest = createHmac("sha256", secret).update(params.body).digest("hex");
  const expected = `sha256=${digest}`;

  if (expected.length !== params.signature.length) {
    return false;
  }

  return Buffer.from(expected).equals(Buffer.from(params.signature));
}

async function githubFetch<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await githubRequest<T>(url, token, init);
  if (!response.ok) {
    const message =
      response.data && typeof response.data === "object" && "message" in response.data
        ? String((response.data as { message?: unknown }).message)
        : `GitHub API request failed with ${response.status}.`;
    throw new Error(message);
  }

  return response.data as T;
}

async function githubRequest<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const response = await fetch(url.startsWith("https://") ? url : `${GITHUB_API_BASE}${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : null;
  return { ok: response.ok, status: response.status, data };
}

export async function getInstallationAccessToken(installationId: string | number): Promise<string> {
  const jwt = createGitHubAppJwt();
  const payload = await githubFetch<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: "POST" },
  );
  return payload.token;
}

export async function githubInstallationFetch<T>(
  installationId: string | number,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getInstallationAccessToken(installationId);
  return githubFetch<T>(path, token, init);
}

export async function githubInstallationRequest<T>(
  installationId: string | number,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const token = await getInstallationAccessToken(installationId);
  return githubRequest<T>(path, token, init);
}



function orgFromRepository(repository: GitHubRepository): { slug: string; name: string } {
  return {
    slug: repository.owner.login.toLowerCase(),
    name: repository.owner.login,
  };
}

function orgFromOwner(owner: GitHubOwner): { slug: string; name: string } {
  return {
    slug: owner.login.toLowerCase(),
    name: owner.login,
  };
}

function secondsBetween(start?: string | null, end?: string | null): number {
  if (!start || !end) {
    return 0;
  }

  const diff = Date.parse(end) - Date.parse(start);
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff / 1000) : 0;
}

function mapConclusion(conclusion?: string | null): WorkflowRun["status"] {
  if (conclusion === "success") {
    return "success";
  }
  if (!conclusion || conclusion === "neutral" || conclusion === "skipped") {
    return "degraded";
  }
  return "failed";
}

function mapJobStatus(conclusion?: string | null): JobExecution["status"] {
  if (conclusion === "success") {
    return "success";
  }
  if (!conclusion || conclusion === "neutral" || conclusion === "skipped") {
    return "flaky";
  }
  return "failed";
}

function mapStepStatus(conclusion?: string | null): StepExecution["status"] {
  if (conclusion === "success") {
    return "success";
  }
  if (!conclusion || conclusion === "neutral" || conclusion === "skipped") {
    return "retried";
  }
  return "failed";
}

function mapRepositoryDefaults(repository: GitHubRepository) {
  return {
    fullName: repository.full_name,
    name: repository.name,
    defaultBranch: repository.default_branch ?? "main",
    visibility: repository.private ? "private" : "public",
    language: repository.language ?? "Unknown",
    team: repository.owner.login,
    monthlyCiMinutes: 0,
    monthlyCiSpendUsd: 0,
    p95DurationSec: 0,
    failureRatePct: 0,
    flakeRatePct: 0,
    cacheHitRatePct: 0,
    runnerUtilizationPct: 0,
    telemetryMode: "github" as const,
    lastIndexedAt: repository.pushed_at ?? repository.updated_at ?? new Date().toISOString(),
  };
}

export async function upsertGitHubRepository(params: {
  installationId: string | number;
  repository: GitHubRepository;
  selected?: boolean;
  installation?: Pick<GitHubInstallationResponse, "html_url" | "repository_selection">;
}) {
  const org = orgFromRepository(params.repository);
  const organization = await prisma.executionOrganization.upsert({
    where: {
      slug: org.slug,
    },
    update: {
      name: org.name,
      githubAppInstallationId: String(params.installationId),
      githubAppRepositorySelection: params.installation?.repository_selection,
      githubAppInstallationUrl: params.installation?.html_url,
    },
    create: {
      slug: org.slug,
      name: org.name,
      plan: "team",
      githubAppInstallationId: String(params.installationId),
      githubAppRepositorySelection: params.installation?.repository_selection,
      githubAppInstallationUrl: params.installation?.html_url,
    },
  });

  const defaults = mapRepositoryDefaults(params.repository);
  return prisma.executionRepository.upsert({
    where: {
      fullName: defaults.fullName,
    },
    update: {
      organizationId: organization.id,
      name: defaults.name,
      defaultBranch: defaults.defaultBranch,
      visibility: defaults.visibility,
      language: defaults.language,
      team: defaults.team,
      selected: params.selected ?? true,
      telemetryMode: defaults.telemetryMode,
      lastIndexedAt: new Date(defaults.lastIndexedAt),
    },
    create: {
      organizationId: organization.id,
      selected: params.selected ?? true,
      ...defaults,
      lastIndexedAt: new Date(defaults.lastIndexedAt),
    },
  });
}

export async function removeGitHubRepository(repositoryFullName: string) {
  await prisma.executionRepository.deleteMany({
    where: {
      fullName: repositoryFullName,
    },
  });
}

export async function disconnectGitHubInstallation(installationId: string | number) {
  await prisma.executionOrganization.updateMany({
    where: {
      githubAppInstallationId: String(installationId),
    },
    data: {
      githubAppInstallationId: null,
      githubAppRepositorySelection: null,
      githubAppInstallationUrl: null,
    },
  });
}

export async function getGitHubInstallation(installationId: string | number) {
  const jwt = createGitHubAppJwt();
  return githubFetch<GitHubInstallationResponse>(`/app/installations/${installationId}`, jwt);
}

async function upsertInstallationOrganization(params: {
  installationId: string | number;
  installation: GitHubInstallationResponse;
}) {
  const account = params.installation.account;
  if (!account?.login) {
    return null;
  }

  const org = orgFromOwner(account);
  return prisma.executionOrganization.upsert({
    where: {
      slug: org.slug,
    },
    update: {
      name: org.name,
      githubAppInstallationId: String(params.installationId),
      githubAppRepositorySelection: params.installation.repository_selection,
      githubAppInstallationUrl: params.installation.html_url,
    },
    create: {
      slug: org.slug,
      name: org.name,
      plan: "team",
      githubAppInstallationId: String(params.installationId),
      githubAppRepositorySelection: params.installation.repository_selection,
      githubAppInstallationUrl: params.installation.html_url,
    },
  });
}

export async function syncInstallationRepositories(installationId: string | number) {
  const installation = await getGitHubInstallation(installationId);
  const organization = await upsertInstallationOrganization({ installationId, installation });
  const token = await getInstallationAccessToken(installationId);
  const repositories: GitHubRepository[] = [];
  let page = 1;

  while (page < 20) {
    const payload = await githubFetch<GitHubInstallationRepositoriesResponse>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    const batch = payload.repositories ?? [];
    repositories.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  for (const repository of repositories) {
    await upsertGitHubRepository({
      installationId,
      repository,
      selected: true,
      installation,
    });
  }

  if (organization) {
    await prisma.executionRepository.deleteMany({
      where: {
        organizationId: organization.id,
        fullName: {
          notIn: repositories.map((repository) => repository.full_name),
        },
      },
    });
  }

  return repositories;
}

export async function syncConnectedGitHubInstallations() {
  const organizations = await prisma.executionOrganization.findMany({
    where: {
      githubAppInstallationId: {
        not: null,
      },
    },
    select: {
      githubAppInstallationId: true,
    },
  });

  const uniqueInstallationIds = Array.from(
    new Set(
      organizations
        .map((organization) => organization.githubAppInstallationId)
        .filter((installationId): installationId is string => Boolean(installationId)),
    ),
  );

  for (const installationId of uniqueInstallationIds) {
    await syncInstallationRepositories(installationId);
  }
}

export async function getRepositoryInstallationId(repositoryFullName: string): Promise<string | null> {
  const repository = await prisma.executionRepository.findUnique({
    where: {
      fullName: repositoryFullName,
    },
    include: {
      organization: true,
    },
  });

  return repository?.organization.githubAppInstallationId ?? null;
}

export async function workflowRunFromGitHub(params: {
  installationId: string | number;
  repository: GitHubRepository;
  workflowRun: GitHubWorkflowRunPayload;
}): Promise<WorkflowRun> {
  const [owner, repo] = params.repository.full_name.split("/");
  const jobsPayload = await githubInstallationFetch<GitHubWorkflowJobsResponse>(
    params.installationId,
    `/repos/${owner}/${repo}/actions/runs/${params.workflowRun.id}/jobs?per_page=100`,
  );
  const githubJobs = jobsPayload.jobs ?? [];
  const jobs: JobExecution[] = githubJobs.map((job): JobExecution => {
    const durationSec = secondsBetween(job.started_at, job.completed_at);
    return {
      id: String(job.id),
      name: job.name,
      dependsOn: [],
      durationSec,
      queueSec: 0,
      status: mapJobStatus(job.conclusion),
      runner: job.runner_name ?? job.labels?.join(", ") ?? "github-hosted",
      cacheHitRate: 0,
      infraUtilization: 0,
      steps:
        job.steps?.map((step): StepExecution => {
          const stepDuration = secondsBetween(step.started_at, step.completed_at);
          return {
            id: `${job.id}-${step.number ?? step.name}`,
            name: step.name,
            durationSec: stepDuration,
            queueSec: 0,
            retries: 0,
            status: mapStepStatus(step.conclusion),
            cacheHitRate: 0,
            cpuPct: 0,
            networkMbps: 0,
          };
        }) ?? [],
    };
  });
  // Tests are now uploaded directly by the SDK finish action — no log scraping needed.
  const tests: TestSignal[] = [];

  const startedAt =
    params.workflowRun.run_started_at ??
    params.workflowRun.created_at ??
    params.workflowRun.updated_at ??
    new Date().toISOString();
  const finishedAt = params.workflowRun.updated_at ?? new Date().toISOString();

  return {
    id: `${params.workflowRun.id}:${params.workflowRun.run_attempt ?? 1}`,
    workflowName:
      params.workflowRun.name ?? params.workflowRun.display_title ?? "GitHub Actions workflow",
    branch: params.workflowRun.head_branch ?? params.repository.default_branch ?? "main",
    commitSha: params.workflowRun.head_sha ?? "",
    startedAt,
    status: mapConclusion(params.workflowRun.conclusion),
    totalDurationSec:
      jobs.reduce((sum, job) => sum + job.durationSec, 0) ||
      secondsBetween(startedAt, finishedAt),
    containerLayerReuse: 0,
    changedFiles: [],
    jobs,
    tests,
    telemetrySource: "github",
    runtimeTelemetry: {
      source: "github",
      samples: [],
      annotations: [
        {
          level: "info",
          source: "github-app-webhook",
          message: `Imported workflow run attempt ${params.workflowRun.run_attempt ?? 1}.`,
        },
      ],
    },
  };
}
