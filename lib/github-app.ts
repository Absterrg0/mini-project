import { createHmac, sign } from "node:crypto";
import { get as httpsGet } from "node:https";
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

interface ParsedJUnitTest {
  name: string;
  file: string;
  failed: boolean;
  durationSec: number;
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

/**
 * Use Node.js's native https module (NOT patched by Next.js) to make the
 * initial request to a GitHub API endpoint and return the raw body or the
 * redirect Location if the server responds with a 3xx.
 *
 * This is necessary because Next.js patches the global `fetch` and silently
 * ignores `redirect: "manual"`, so we cannot use fetch to intercept GitHub's
 * 302 redirect to a presigned S3 URL.
 */
function resolveGitHubRedirect(
  url: string,
  headers: Record<string, string>,
): Promise<{ redirectUrl: string | null; status: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpsGet(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const isRedirect = res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400;
        resolve({
          redirectUrl: isRedirect ? (res.headers.location ?? null) : null,
          status: res.statusCode ?? 0,
          body,
        });
      });
    });
    req.on("error", (err) => resolve({ redirectUrl: null, status: 0, body: String(err) }));
    req.setTimeout(20_000, () => { req.destroy(); resolve({ redirectUrl: null, status: 0, body: "timeout" }); });
  });
}

async function githubInstallationText(
  installationId: string | number,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const token = await getInstallationAccessToken(installationId);
  const fullUrl = path.startsWith("https://") ? path : `${GITHUB_API_BASE}${path}`;

  // Use Node's https module (unpatched by Next.js) to make the initial request.
  // GitHub's /actions/jobs/{id}/logs endpoint returns a 302 to a presigned S3
  // URL. Next.js's fetch wrapper ignores `redirect:"manual"`, so if we used
  // fetch it would auto-follow the redirect — sending our Bearer token to S3
  // which causes a SignatureDoesNotMatch error (the 158-byte response we observed).
  const authHeaders: Record<string, string> = {
    Accept: "text/plain",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };

  const initial = await resolveGitHubRedirect(fullUrl, authHeaders);

  if (initial.redirectUrl) {
    // Fetch the presigned S3 URL with NO auth headers — S3 presigned URLs are
    // self-authenticating and reject additional auth headers.
    console.log(`[execforge:logs] following redirect → S3 (status=${initial.status})`);
    const s3 = await fetch(initial.redirectUrl);
    return { ok: s3.ok, status: s3.status, text: await s3.text() };
  }

  const ok = initial.status >= 200 && initial.status < 300;
  return { ok, status: initial.status, text: initial.body };
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

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizeLogLine(line: string) {
  return stripAnsi(line)
    .replace(/^\d{4}-\d{2}-\d{2}T[^\s]+\s+/, "")
    .trimEnd();
}

/** Decode the five XML predefined entities. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extract a single XML attribute value from a tag's attribute string.
 * Handles both double-quoted and single-quoted values.
 */
function xmlAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const dq = attrs.match(re);
  if (dq?.[1] !== undefined) return decodeXmlEntities(dq[1]);
  const sq = attrs.match(new RegExp(`\\b${name}='([^']*)'`, "i"));
  return sq?.[1] !== undefined ? decodeXmlEntities(sq[1]) : "";
}

/**
 * Resolve the best possible file path from JUnit `file` and `classname` attributes.
 *
 * node --test --test-reporter=junit puts the absolute file path in `file`
 * (e.g. "/home/runner/work/repo/test/foo.test.js") and just "test" in `classname`.
 * We prefer `file`, strip the runner workspace prefix, and fall back through
 * `classname` to a slug derived from the test name.
 */
function fileFromJUnit(fileAttr: string, classname: string, testName: string): string {
  // Prefer the `file` attribute — it contains the absolute path on the runner.
  if (fileAttr && fileAttr !== "[eval]") {
    // Strip common GitHub Actions runner prefixes so we get a repo-relative path.
    // Pattern: /home/runner/work/<repo>/<repo>/  or  /home/runner/work/_temp/*
    const stripped = fileAttr
      .replace(/\\/g, "/")
      .replace(/^\/home\/runner\/work\/[^/]+\/[^/]+\//, "")
      .replace(/^\/github\/workspace\//, "");
    if (stripped && stripped !== fileAttr.replace(/\\/g, "/")) {
      // Successfully stripped — return clean relative path
      return stripped;
    }
    // Fall back to last two segments of the absolute path (e.g. test/foo.test.js)
    const parts = fileAttr.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join("/");
    if (parts.length === 1) return parts[0];
  }

  // `classname` from non-node runners (Maven, pytest, etc.) uses dotted notation.
  if (classname && classname !== "test" && classname !== "[eval]") {
    if (classname.includes("/") || classname.includes("\\") || /\.[a-z]{2,5}$/.test(classname)) {
      return classname.replace(/\\/g, "/");
    }
    // Dotted class name — convert to path (e.g. com.example.MyTest → com/example/MyTest.test)
    if (classname.includes(".")) {
      return classname.replace(/\./g, "/") + ".test";
    }
  }

  // Last resort: derive a slug from the test name.
  const slug = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `tests/${slug || "unknown"}.test.js`;
}

/**
 * Find and return the raw `<testsuites>…</testsuites>` XML block embedded
 * in a GitHub Actions job log (which has per-line ISO-8601 timestamps).
 * Returns null if no JUnit XML is found.
 */
function extractJUnitXml(log: string): string | null {
  const text = log.split(/\r?\n/).map(normalizeLogLine).join("\n");
  const openIdx = text.search(/<testsuites[\s>]/);
  if (openIdx === -1) {
    console.log(`[execforge:tests] extractJUnitXml — no <testsuites> found in ${text.length} char log`);
    return null;
  }
  const closeTag = "</testsuites>";
  const closeIdx = text.indexOf(closeTag, openIdx);
  if (closeIdx === -1) {
    console.log(`[execforge:tests] extractJUnitXml — found <testsuites> at ${openIdx} but no closing tag`);
    return null;
  }
  const xml = text.slice(openIdx, closeIdx + closeTag.length);
  console.log(`[execforge:tests] extractJUnitXml — extracted ${xml.length} chars of XML`);
  return xml;
}

/**
 * Parse JUnit XML produced by `node --test --test-reporter=junit`
 * (or any standard JUnit-compatible reporter) from a raw job log string.
 *
 * Handles:
 * - Self-closing testcase elements (passing tests from node:test)
 * - Regular testcase elements with <failure> or <error> children
 * - XML entities in attribute values
 */
function parseJUnitXmlFromLog(log: string): ParsedJUnitTest[] {
  const xml = extractJUnitXml(log);
  if (!xml) return [];

  const tests: ParsedJUnitTest[] = [];

  // Match both self-closing `<testcase ... />` and paired `<testcase ...>...</testcase>`
  const re = /<testcase\b([^>]*?)(\/?>)([\s\S]*?(?=<testcase\b|<\/testsuites))/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const attrs  = m[1];           // everything inside the opening tag
    const selfClose = m[2] === "/>";
    const body   = selfClose ? "" : m[3]; // content between open and next <testcase / </testsuites>

    const name      = xmlAttr(attrs, "name");
    const fileAttr  = xmlAttr(attrs, "file");
    const classname = xmlAttr(attrs, "classname");
    const timeStr   = xmlAttr(attrs, "time");

    if (!name) continue;

    // A test is failed if the element carries a failure/error attribute OR
    // contains a <failure> or <error> child element.
    const failed =
      xmlAttr(attrs, "failure").length > 0 ||
      /<failure[\s/>]/i.test(body) ||
      /<error[\s/>]/i.test(body);

    const durationSec = parseFloat(timeStr);

    tests.push({
      name,
      file: fileFromJUnit(fileAttr, classname, name),
      failed,
      durationSec: Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0,
    });
  }

  return tests;
}

function aggregateParsedTests(tests: ParsedJUnitTest[]): TestSignal[] {
  const map = new Map<string, TestSignal>();

  for (const test of tests) {
    const key = `${test.file}::${test.name}`;
    const current = map.get(key) ?? {
      name: test.name,
      file: test.file,
      runs: 0,
      failures: 0,
      retries: 0,
      avgDurationSec: 0,
    };
    const nextRuns = current.runs + 1;
    current.avgDurationSec =
      nextRuns > 0
        ? (current.avgDurationSec * current.runs + test.durationSec) / nextRuns
        : test.durationSec;
    current.runs = nextRuns;
    current.failures += test.failed ? 1 : 0;
    map.set(key, current);
  }

  return [...map.values()];
}

async function parseTestsFromWorkflowJobLogs(params: {
  installationId: string | number;
  owner: string;
  repo: string;
  jobs: GitHubWorkflowJob[];
}) {
  const parsed: ParsedJUnitTest[] = [];
  console.log(`[execforge:tests] parseTestsFromWorkflowJobLogs — ${params.jobs.length} jobs for ${params.owner}/${params.repo}`);

  for (const job of params.jobs) {
    console.log(`[execforge:tests] job ${job.id} name="${job.name}" completed_at=${job.completed_at ?? "null"} conclusion=${job.conclusion ?? "null"}`);
    if (!job.completed_at) {
      console.log(`[execforge:tests] job ${job.id} skipped — not yet completed`);
      continue;
    }

    try {
      const response = await githubInstallationText(
        params.installationId,
        `/repos/${params.owner}/${params.repo}/actions/jobs/${job.id}/logs`,
      );
      console.log(`[execforge:tests] job ${job.id} logs fetch: ok=${response.ok} textLen=${response.text?.length ?? 0}`);
      if (!response.ok || !response.text) continue;
      const jobTests = parseJUnitXmlFromLog(response.text);
      console.log(`[execforge:tests] job ${job.id} parsed ${jobTests.length} tests from JUnit XML`);
      if (jobTests.length === 0) {
        // Print the first 500 chars of the log to show what we got
        console.log(`[execforge:tests] job ${job.id} log sample (first 500 chars):`, response.text.slice(0, 500));
      }
      parsed.push(...jobTests);
    } catch (error) {
      console.warn(`[execforge:tests] Unable to parse tests from GitHub job ${job.id} logs`, error);
    }
  }

  const aggregated = aggregateParsedTests(parsed);
  console.log(`[execforge:tests] parseTestsFromWorkflowJobLogs — aggregated to ${aggregated.length} test signals`);
  return aggregated;
}

export async function loadTestsFromGitHubWorkflowRun(params: {
  installationId: string | number;
  repositoryFullName: string;
  workflowRunId: string | number;
}) {
  const [owner, repo] = params.repositoryFullName.split("/");
  const jobsPayload = await githubInstallationFetch<GitHubWorkflowJobsResponse>(
    params.installationId,
    `/repos/${owner}/${repo}/actions/runs/${params.workflowRunId}/jobs?per_page=100`,
  );

  return parseTestsFromWorkflowJobLogs({
    installationId: params.installationId,
    owner,
    repo,
    jobs: jobsPayload.jobs ?? [],
  });
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
  const [jobs, tests] = await Promise.all([
    Promise.resolve(githubJobs.map((job): JobExecution => {
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
    })),
    loadTestsFromGitHubWorkflowRun({
      installationId: params.installationId,
      repositoryFullName: params.repository.full_name,
      workflowRunId: params.workflowRun.id,
    }),
  ]);

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
