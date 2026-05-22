# ExecForge — Project Context

This document describes the high-level architecture, design decisions, and conventions used throughout the ExecForge codebase. Read it before making significant changes.

---

## What Is ExecForge?

ExecForge is a CI observability platform for GitHub Actions. It collects telemetry from running jobs, stores it in Postgres, and surfaces it in a web dashboard with AI-powered analysis.

It has three main concerns:

1. **Telemetry collection** — capturing CPU, memory, duration, job outcome, and test results from every CI run.
2. **Telemetry ingestion** — receiving, validating, deduplicating, and persisting telemetry from two independent sources (SDK and GitHub App webhook).
3. **Analytics and actions** — displaying run history, test quality metrics (including the Tests dashboard: recent activity feed, inventory, workflow rerun), failure clusters, and generating optimization pull requests.

---

## Package Boundaries

| Package | What it owns |
|---|---|
| `sdk/` | The `@execforge/runtime` npm package and GitHub Action. Everything related to collecting telemetry inside a CI runner. |
| `webapp/` | The Next.js app, Postgres schema, all API routes, the dashboard UI, and the GitHub App integration. |
| `testing-execforge/` | A sample target repository that generates realistic telemetry for development and QA. |

There is no shared code between `sdk/` and `webapp/`. They communicate exclusively over HTTP via the ingestion API.

---

## Telemetry Data Flow

```
GitHub Actions Runner
  │
  ├─ execforge-runtime/start
  │    Writes .execforge/runtime-state.json (start samples, machine info)
  │
  ├─ [customer workflow steps]
  │
  └─ execforge-runtime/finish
       Reads runtime-state.json
       Discovers and parses JUnit XML (auto-discovery from well-known paths)
       POSTs RuntimeEnvelope → POST /api/ingestion/runtime-telemetry
       Writes .execforge/runtime-envelope.json (local fallback)

GitHub App webhook (workflow_run completed)
  │
  └─ POST /api/github/webhooks
       Verifies HMAC-SHA256 signature
       Fetches job/step data from GitHub API
       Calls ingestWorkflowRun()

Both paths converge at:
  prisma.workflowRunSnapshot.upsert()
  key: externalRunId = "${runId}:${attempt}"

Priority rule:
  SDK telemetry (telemetrySource = "execforge-wrapper") is NEVER overwritten by the webhook.
  The webhook only fills in data that the SDK has not yet provided.
```

---

## Idempotency Strategy

Ingestion is idempotent at every level:

- **SDK**: Sends an `Idempotency-Key` header of the form `runtime:{repo}:{runId}:{attempt}`. The API stores this in `IngestionEvent` with `ON CONFLICT DO UPDATE` semantics.
- **Webhook**: Uses `x-github-delivery` as the delivery ID for `IngestionEvent`.
- **WorkflowRunSnapshot**: Upserted on `externalRunId` which encodes `runId:attempt`. Re-runs are separate rows.

---

## Authentication and Authorization

Two separate auth systems exist, serving different audiences:

### User Auth (dashboard access)
- **Better Auth** with GitHub OAuth provider.
- Sessions stored in Postgres.
- All dashboard routes require a valid session.

### SDK Auth (telemetry ingestion)
- **Scoped ingestion tokens** prefixed `exf_`.
- Tokens are hashed with SHA-256 before storage; plaintext is never persisted.
- Each token is scoped to either an organization or a specific repository.
- Validated in `lib/ingestion-auth.ts` before any telemetry write.

---

## GitHub App Integration

ExecForge uses a GitHub App (not a personal access token) for two reasons:

1. **Webhooks** — the App receives `workflow_run` events so runs are tracked even without the SDK installed.
2. **API access** — the App's installation token is used to fetch job/step data and to create pull requests for the PR agent.

JWT generation (`lib/github-app.ts → createGitHubAppJwt`) uses the App's RSA private key stored as `GITHUB_APP_PRIVATE_KEY`. The key must be stored with literal `\n` characters in the environment variable.

---

## JUnit XML Parsing

The SDK's `parseJUnitXmlFile()` function in `sdk/src/runtime.ts` is a custom regex-based parser (no external XML library):

- Maps `<testsuite name="...">` to file paths (Node.js's JUnit reporter uses the absolute file path as the suite name).
- Strips GitHub runner workspace prefixes (`/home/runner/work/<repo>/<repo>/`) to produce repo-relative paths.
- Resolution order for test file attribution: `file` attribute → testsuite name → `classname` → `"unknown"`.
- Handles both self-closing `<testcase ... />` and full `<testcase>...<failure>...</failure></testcase>` forms.

---

## Caching Strategy

The dashboard snapshot is cached with Next.js `unstable_cache`:

```typescript
const getCachedSnapshot = unstable_cache(
  async () => { ... },
  ["execution-snapshot"],
  { revalidate: 20, tags: ["execution-snapshot"] }
);
```

The `"execution-snapshot"` tag is revalidated (`revalidateTag`) immediately when:
- A new workflow run webhook is received.
- The user clicks Refresh or Live in the dashboard.

---

## Branch Guard

Runs from ExecForge's own internal branches (`exec-intel/*`) are filtered out at the display layer by `lib/branch-guard.ts → filterExecForgeRuns`. These branches are created by the PR agent when generating optimization pull requests. They should never appear in customer dashboards.

---

## PR Agent

The PR agent (`app/dashboard/pr-agent/`) uses an AI model to:

1. Analyse a specific workflow run and its test/step failures.
2. Propose one or more optimization actions (e.g., fix flaky test, add caching, refactor slow step).
3. Generate a `OptimizationPullRequestPlan` with file diffs.
4. Create a branch and open a pull request via the GitHub App installation token.

Plans are persisted in `OptimizationPlanRecord` so the UI can track their status (raised → merged).

---

## AI Scan

The AI scan (`lib/ai-scan-stale.ts`, `lib/ai-scan-carry-forward.ts`) periodically analyses runs for CI quality issues and stores results in `AiScanResult`. Stale scans are carried forward to the next run if no new commit has occurred. This prevents the dashboard from showing blank AI panels on re-runs.

---

## Code Conventions

- **TypeScript** throughout both `sdk/` and `webapp/`.
- **No `any`** — all Prisma `InputJsonValue` casts are explicit and annotated.
- **Server components first** — Next.js App Router pages are server components by default; client components are explicitly marked `"use client"`.
- **No root `package.json`** — each sub-package manages its own dependencies. Run commands from within `webapp/` or `sdk/`.
- **Prisma migrations** — use `npm run prisma:migrate` (dev) and never modify the database schema directly.
- **Environment variables** — all required vars are documented in `webapp/.env.example`. Missing vars throw `GitHubAppConfigurationError` at runtime rather than failing silently.
- **Error handling in telemetry paths** — telemetry posting in the SDK is "best-effort": it logs warnings on failure but never throws, so CI pipelines are never broken by an observability tool.

---

## Testing Philosophy

ExecForge does not (yet) have a unit test suite. Quality is validated by:

1. TypeScript — `npm run typecheck` in both packages.
2. ESLint — `npm run lint` in the webapp.
3. Build — `npm run build` verifies the Next.js app compiles cleanly.
4. Live integration — `testing-execforge` acts as a real test target whose CI runs are observed through ExecForge itself.

---

## Deployment

The webapp is deployed to Vercel (the `.vercel/` directory is present). The SDK is published to npm as `@execforge/runtime`. The GitHub Action is published from the `sdk/` repository root as `Absterrg0/execforge-runtime@v1`.

For production, ensure:
- Postgres is on a managed service with TLS.
- `BETTER_AUTH_URL` matches the deployed domain exactly.
- GitHub App webhook URL points to the production domain.
- All secrets are rotated from any values that appeared in development logs or chat.
