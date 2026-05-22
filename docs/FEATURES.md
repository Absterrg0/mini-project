# ExecForge — Feature Reference

A complete feature inventory organized by area. Use this as a quick reference to understand what the platform does and where each capability lives in the codebase.

---

## Telemetry Collection (SDK)

### Resource Sampling
- **CPU utilisation** — burst-sampled (3 samples × 400 ms) at both job start and finish.
- **Memory RSS** — sampled at the same burst intervals.
- **Duration** — wall-clock time from `start` step to `finish` step.
- **Runner info** — OS, architecture, runner name, CPU count, total RAM from environment variables and `node:os`.

**Code**: `sdk/src/runtime.ts → startCapture()`, `finishCapture()`, `burstSample()`

### Job Outcome Capture
- Maps `${{ job.status }}` (GitHub expression) to an exit code integer: `success=0`, `failure=1`, `cancelled=2`.
- Also accepts an explicit `EXECFORGE_JOB_EXIT_CODE` environment variable for non-GitHub environments.

**Code**: `sdk/src/runtime.ts → jobStatusToExitCode()`

### JUnit XML Auto-Discovery
- Scans well-known paths at finish time: `junit-results.xml`, `junit.xml`, `test-results.xml`, `test-results/junit.xml`, `test-report.xml`, `reports/junit.xml`.
- Custom path configurable via `EXECFORGE_JUNIT_PATH` or the SDK config.
- Parses `<testsuite>` → `<testcase>` structure without external XML libraries.
- Strips runner workspace prefixes to produce repo-relative file paths.
- Captures per-test: name, file, duration (seconds), pass/fail, failure message.

**Code**: `sdk/src/runtime.ts → parseJUnitXmlFile()`, `finishCapture()`

### Telemetry Envelope
- Wraps all telemetry in a `RuntimeEnvelope` with schema/collector versions, repository full name, `runId:attempt` composite key, workflow name, branch, and commit SHA.
- Written to `.execforge/runtime-envelope.json` as a local fallback regardless of network success.

**Code**: `sdk/src/runtime.ts → buildEnvelope()`

### Retry and Best-Effort Posting
- Three POST attempts with exponential backoff (500 ms, 1 s, 2 s).
- Never throws — logs warnings on failure so CI pipelines are never broken by telemetry.
- Prints a warning if `EXECFORGE_API_TOKEN` or `EXECFORGE_API_URL` is missing.

**Code**: `sdk/src/runtime.ts → postTelemetryBestEffort()`

---

## GitHub Action

### Capture Modes
- **`auto`** (default) — single step using GitHub's post-job hook to finish capture after all steps complete.
- **`start` / `finish`** (recommended) — explicit split steps. `finish` always runs with `if: always()`. Preferred because `${{ job.status }}` is available for accurate outcome capture.
- **`run`** (legacy) — wraps a single shell command inline. Prefer start/finish instead.

**Code**: `sdk/src/action.ts`, `sdk/action.yml`, `sdk/start/`, `sdk/finish/`

### Outputs
- `started` — `"true"` when capture successfully started.
- `posted` — `"true"` when telemetry was successfully posted to the API.
- `exit-code` — exit code of the wrapped command (mode=run only).

---

## CLI

- `execforge start` — start capture (writes state file).
- `execforge finish [--exit-code <n>]` — finish capture and post telemetry.
- `execforge run -- "<command>"` — legacy single-step wrapper.
- Install: `npm install --save-dev @execforge/runtime` or use `npx @execforge/runtime`.

**Code**: `sdk/src/cli.ts`

---

## Telemetry Ingestion (Webapp)

### SDK Ingestion Endpoint
- `POST /api/ingestion/runtime-telemetry`
- Validates `Authorization: Bearer exf_...` token against a scoped org/repo token in Postgres.
- Parses and validates the `RuntimeEnvelope` payload.
- Upserts `WorkflowRunSnapshot` with test results, resource samples, and metadata.
- Uses `Idempotency-Key` header to deduplicate retried uploads.

**Code**: `webapp/app/api/ingestion/runtime-telemetry/route.ts`, `webapp/lib/ingestion-auth.ts`

### GitHub App Webhook Ingestion
- `POST /api/github/webhooks`
- Verifies HMAC-SHA256 `x-hub-signature-256` header using `GITHUB_APP_WEBHOOK_SECRET`.
- Handles events: `installation`, `installation_repositories`, `repository`, `workflow_run`.
- On `workflow_run`: fetches job and step data from the GitHub API, builds a `WorkflowRun`, upserts `WorkflowRunSnapshot`.
- Never overwrites SDK telemetry — if `telemetrySource = "execforge-wrapper"` already exists, webhook update skips telemetry fields.
- Preserves SDK-uploaded test results even if the webhook fires after with empty test data.

**Code**: `webapp/app/api/github/webhooks/route.ts`, `webapp/lib/github-app.ts → workflowRunFromGitHub()`

### Conflict Resolution
- SDK telemetry always wins over webhook data.
- Test results are merged: incoming SDK tests take precedence; existing SDK tests are preserved if the webhook provides none.
- `IngestionEvent` audit log records every write attempt with `source`, `status`, and `idempotencyKey`.

**Code**: `webapp/lib/execution-store.ts → ingestWorkflowRun()`

---

## GitHub App Integration

### Installation Management
- Installs into GitHub organizations or individual repositories.
- Syncs repository list on installation events and on dashboard Refresh.
- Removes repositories from Postgres when uninstalled.

**Code**: `webapp/lib/github-app.ts → syncInstallationRepositories()`, `disconnectGitHubInstallation()`

### Installation Access Tokens
- GitHub App JWT is generated on demand (10-minute expiry, 60-second clock skew buffer).
- Exchanged for a per-installation access token for each API call.
- No long-lived tokens stored in the database.

**Code**: `webapp/lib/github-app.ts → createGitHubAppJwt()`, `getInstallationAccessToken()`

---

## Authentication

### User Authentication
- GitHub OAuth sign-in via Better Auth.
- Sessions stored in Postgres.
- All dashboard and settings routes require a valid session.

**Code**: `webapp/lib/auth.ts`, `webapp/app/sign-in/`

### Ingestion Tokens
- Scoped tokens prefixed `exf_` for SDK authentication.
- Hashed with SHA-256 on creation; plaintext is returned once and never stored.
- Tokens are scoped to an organization or a specific repository.
- Created from `Settings → API Keys` in the dashboard.

**Code**: `webapp/lib/ingestion-tokens.ts`, `webapp/lib/ingestion-auth.ts`

---

## Dashboard

### Run History
- Displays all ingested `WorkflowRunSnapshot` records ordered by start time.
- Shows: workflow name, branch, commit, status (success / failed / degraded), duration, telemetry source.
- Live mode auto-refreshes every ~20 seconds via Next.js cache revalidation.

**Code**: `webapp/app/dashboard/page.tsx`, `webapp/lib/queries.ts`

### Tests Page (`/dashboard/tests`)
- Repository-scoped test intelligence aggregated from ingested CI runs.
- **Scorecard metrics**: tests tracked, failure rate, runs affected, average duration (aligned with the overview dashboard card style).
- **Test scaffold launcher**: create dispatchable workflows and open PRs for flaky, failing, slow, e2e, or unit scenarios.
- **Recent activity**: scrollable feed of the latest CI runs (newest first) with branch, duration, test pass/fail counts, and failing test names — replaces the old color-strip timeline.
- **Slowest tests**: ranked list with duration bars for tests above typical runtime.
- **Test inventory**: sortable table by impact with per-test run history (hover summary), status, duration, last seen, and **Rerun** (`workflow_dispatch` via GitHub App).
- **Rerun API**: `POST /api/github/dispatch` resolves workflow file names to GitHub workflow IDs and triggers `workflow_dispatch` on the default branch. Requires GitHub App **Actions: Read and write** on the installation.

**Code**: `webapp/app/dashboard/tests/page.tsx`, `webapp/components/dashboard/recent-ci-activity.tsx`, `webapp/components/dashboard/trigger-workflow-button.tsx`, `webapp/app/api/github/dispatch/route.ts`

### Run Drilldown
- Individual run view: job breakdown, step timing, test results, resource samples.
- AI scan results embedded inline.
- PR agent action buttons for each detected optimization opportunity.

**Code**: `webapp/app/dashboard/runs/`

### Failure Clusters
- Groups failing steps across runs by category: `dependency-install`, `docker-build`, `test-failure`, `flaky-test`, `workflow-step`.
- Severity levels: `low` (1–2 occurrences), `medium` (3–5), `high` (6+).
- Links to the most recent affected run.

**Code**: `webapp/lib/telemetry-analytics.ts → clusterFailures()`

### Telemetry Coverage Status
- Per-repository status indicator: `github_only`, `enriched`, `stale`, `ingestion_failing`.
- `enriched` = SDK wrapper samples present in the latest run.
- `stale` = no run indexed in the last 7 days.
- `ingestion_failing` = wrapper mode enabled but latest run has zero samples.

**Code**: `webapp/lib/telemetry-analytics.ts → buildTelemetryCoverage()`

### Ingestion Pipeline Health
- Shows sync cursor, events processed in the last 24 hours, webhook delivery rate, and health checks per organization.

**Code**: `webapp/app/dashboard/ingestion/`, `webapp/lib/execution-store.ts → mapPipelineRecord()`

---

## AI Features

### AI Scan
- Analyses workflow runs for CI quality issues (flakiness, slow steps, missing caching).
- Results stored in `AiScanResult` linked to a `WorkflowRunSnapshot`.
- Stale scans are carried forward: if no new commit SHA, the previous scan result is reused for the next run to avoid blank panels.

**Code**: `webapp/lib/ai-scan-stale.ts`, `webapp/lib/ai-scan-carry-forward.ts`

### PR Agent
- Generates `OptimizationPullRequestPlan` objects with file-level diffs.
- One-click PR creation: creates a branch (`exec-intel/...`) and opens a pull request via the GitHub App.
- Plans are persisted in `OptimizationPlanRecord` so the UI tracks raised → merged status.
- Supported action types: fix flaky test, add missing test coverage, optimize slow step, add dependency caching.

**Code**: `webapp/app/dashboard/pr-agent/`, `webapp/lib/execution-store.ts → recordOptimizationPlan()`

### AI Provider
- Server-side AI client configured in `webapp/lib/ai-provider.server.ts`.
- Client-side streaming configured in `webapp/lib/ai-provider.ts`.
- Model selection is configurable via environment variable.

**Code**: `webapp/lib/ai-provider.server.ts`, `webapp/lib/ai-provider.ts`

---

## Onboarding

- Step-by-step wizard at `/onboarding`.
- Installs the GitHub App into the user's organization.
- Imports repositories from the installation.
- Creates a scoped runtime token.
- Displays the copy-once plaintext token and the exact YAML snippet to add to the user's CI workflow.

**Code**: `webapp/app/onboarding/`

---

## Branch Guard

- All runs from `exec-intel/*` branches (created by the PR agent) are filtered out before display.
- Applied at the query layer so they never appear in run history, test analytics, or failure clusters.

**Code**: `webapp/lib/branch-guard.ts → filterExecForgeRuns()`

---

## Caching

- Dashboard snapshot is cached for 20 seconds using Next.js `unstable_cache` tagged `"execution-snapshot"`.
- Tag is invalidated immediately on new webhook events or explicit user refresh.
- Cache bypassed entirely when `refreshGitHubInstallations: true` is requested (Refresh button).

**Code**: `webapp/lib/execution-store.ts → getCachedSnapshot()`, `loadExecutionSnapshot()`

---

## Sample Target Repository (`testing-execforge`)

### Intentional Test Signals
- **Slow test** (`execforge-slow.test.js`) — 3.5 s delay to surface slow-test tracking.
- **Random flaky test** (`flaky-random.test.js`) — ~30% failure rate to exercise flakiness metrics.
- **Timing-sensitive flaky test** (`flaky-timing.test.js`) — fails under high runner load.

### Dispatchable Workflows
- Individual `workflow_dispatch` workflows per test type.
- Enable per-test reruns directly from the ExecForge dashboard Tests page without re-running the full CI suite.

**Code**: `testing-execforge/.github/workflows/`, `testing-execforge/test/`
