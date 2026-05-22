# ExecForge

**CI telemetry and test intelligence for GitHub Actions.**

ExecForge captures CPU, memory, duration, job status, and per-test results from every CI run and surfaces them in a real-time analytics dashboard. It ships as two independent packages and a sample target repository that demonstrates the full integration.

---

## What ExecForge Does

- **Collects CI telemetry** — the SDK wraps your GitHub Actions jobs and sends resource samples, timing, and job outcomes to a central backend.
- **Ingests GitHub webhook events** — the backend listens to `workflow_run` webhooks from a GitHub App to track runs even without the SDK installed.
- **Parses JUnit XML** — the SDK automatically discovers and parses test report files, mapping individual test cases to source files and tracking pass/fail/duration.
- **Displays a live dashboard** — the Next.js webapp shows run history, failure clusters, a Tests page (metrics, recent CI activity, slowest tests, inventory with rerun), and AI-powered analysis with one-click PR generation.
- **Generates optimization PRs** — the PR agent creates targeted pull requests to fix flaky tests, add missing coverage, or optimize workflow steps.

---

## Repository Layout

```
project/
├── sdk/                   # @execforge/runtime — GitHub Action + CLI SDK
│   ├── src/               # TypeScript source
│   │   ├── runtime.ts     # Core capture, JUnit parsing, and telemetry upload
│   │   ├── action.ts      # GitHub Action entrypoint
│   │   ├── cli.ts         # npx execforge CLI
│   │   ├── config.ts      # Config resolution (env → action inputs → defaults)
│   │   └── types.ts       # Shared telemetry types
│   ├── action.yml         # Action manifest (start / finish / auto modes)
│   ├── start/             # Explicit start sub-action
│   └── finish/            # Explicit finish sub-action
│
├── webapp/                # Next.js dashboard + ingestion API
│   ├── app/               # App Router pages and API routes
│   │   ├── dashboard/     # Main dashboard (runs, tests, PR agent)
│   │   ├── onboarding/    # GitHub App install + token creation wizard
│   │   └── api/           # REST endpoints
│   │       ├── ingestion/runtime-telemetry/  # SDK upload endpoint
│   │       └── github/webhooks/              # GitHub App webhook handler
│   ├── lib/               # Server-side business logic
│   │   ├── execution-store.ts    # Prisma read/write and data mapping
│   │   ├── github-app.ts         # GitHub App JWT auth, webhook verification, API calls
│   │   ├── telemetry-analytics.ts # Coverage status and failure clustering
│   │   ├── ingestion-tokens.ts   # Scoped token creation and validation
│   │   └── queries.ts            # Dashboard data queries
│   └── prisma/
│       └── schema.prisma  # Postgres schema
│
└── testing-execforge/     # Sample target repo — demonstrates ExecForge in action
    ├── test/              # Intentionally slow, flaky, and timing-sensitive tests
    └── .github/workflows/ # CI workflows with start/finish SDK steps
```

There is intentionally **no root `package.json`**. Run all commands from within `webapp/` or `sdk/`.

---

## How It Works

```
Customer repo (GitHub Actions)
  └─ execforge-runtime/start   ← records machine info + start samples
  └─ [your existing steps]
  └─ execforge-runtime/finish  ← records finish samples, parses JUnit XML, POSTs telemetry
         │
         ▼
POST /api/ingestion/runtime-telemetry   (Bearer exf_... token)
         │
         ▼
Postgres  ←──────── GitHub App webhook (workflow_run events)
         │
         ▼
Next.js dashboard  →  runs · tests · PR agent · failure clusters
```

Two ingestion paths write to the same `WorkflowRunSnapshot` row:
1. **SDK path** — enriched: CPU/memory samples, JUnit test results, exact job status.
2. **Webhook path** — GitHub-only: job names, step timing, conclusion from the GitHub API.

The webhook path never overwrites SDK telemetry once it is present.

---

## Packages

### `sdk/` — `@execforge/runtime`

The runtime SDK is both a **GitHub Action** and an **npm CLI**.

#### GitHub Action (recommended)

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: Absterrg0/execforge-runtime/start@v1
    env:
      EXECFORGE_API_TOKEN: ${{ secrets.EXECFORGE_API_TOKEN }}

  # ... all your existing steps ...

  - uses: Absterrg0/execforge-runtime/finish@v1
    if: always()
    env:
      EXECFORGE_API_TOKEN: ${{ secrets.EXECFORGE_API_TOKEN }}
      EXECFORGE_JOB_STATUS: ${{ job.status }}
```

#### What is captured

| Signal | Description |
|---|---|
| CPU % | Burst-sampled at start and finish |
| Memory RSS (MB) | Burst-sampled at start and finish |
| Duration | Wall-clock start → finish |
| Job outcome | success / failure / cancelled via `${{ job.status }}` |
| Runner info | OS, arch, CPU count, total RAM, runner name |
| Workflow metadata | repo, branch, commit SHA, workflow name, run ID |
| Test results | Auto-discovered JUnit XML → per-test name, file, duration, pass/fail |

See [`sdk/README.md`](sdk/README.md) for full configuration reference.

### `webapp/` — Next.js Dashboard

The webapp is the central backend and UI. It handles:

- **Authentication** — GitHub OAuth sign-in via Better Auth.
- **GitHub App** — installs into customer organizations, receives webhook events, manages installation tokens.
- **Ingestion API** — validates scoped tokens, writes SDK telemetry and GitHub webhook data to Postgres.
- **Dashboard pages** — run history, test analytics, failure cluster analysis, AI scan results, PR agent.

See [`webapp/README.md`](webapp/README.md) for local setup and production notes.

### `testing-execforge/` — Sample Target Repository

A minimal Next.js app whose sole purpose is to generate realistic telemetry signals for ExecForge development and testing. It contains:

- **`test/execforge-slow.test.js`** — a deliberately slow test (3.5 s delay) to surface slow-test tracking.
- **`test/flaky-random.test.js`** — a test that fails ~30% of the time to exercise flakiness detection.
- **`test/flaky-timing.test.js`** — a timing-sensitive test that fails under high runner load.
- **`.github/workflows/`** — individual dispatchable workflows per test type, plus a combined CI workflow.

See [`testing-execforge/README.md`](testing-execforge/README.md) for details.

---

## Local End-To-End Setup

### 1. Start Postgres

```bash
docker run --name execforge-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=execforge \
  -p 5432:5432 \
  -d postgres:16
```

If the container already exists:

```bash
docker start execforge-postgres
```

### 2. Configure GitHub OAuth

```
GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
Homepage URL: http://localhost:3000
Authorization callback URL: http://localhost:3000/api/auth/callback/github
```

Copy the client ID and secret.

### 3. Configure the GitHub App

```
GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
```

For local webhook testing, run a tunnel:

```bash
ngrok http 3000
```

Use:

```
Callback URL: http://localhost:3000/api/github/app/callback
Setup URL:    http://localhost:3000/api/github/app/callback
Webhook URL:  https://your-ngrok-host/api/github/webhooks
```

Required webhook events:

```
Installation target · Repository · Workflow run · Workflow job
Check suite · Check run · Pull request · Push
```

Required repository permissions:

```
Metadata: Read
Actions: Read and write   # write is required for dashboard Rerun (workflow_dispatch)
Checks: Read
Contents: Read & Write
Pull requests: Read & Write
```

After changing app permissions, open each installation and accept the permission upgrade request.

Generate a private key and store it with newline escapes (`\n`) in `GITHUB_APP_PRIVATE_KEY`.

### 4. Configure the Webapp

```bash
cd webapp
cp .env.example .env
```

Fill in `webapp/.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/execforge?schema=public"
BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
BETTER_AUTH_URL="http://localhost:3000"
GITHUB_CLIENT_ID="your-github-oauth-client-id"
GITHUB_CLIENT_SECRET="your-github-oauth-client-secret"
GITHUB_APP_ID="your-github-app-id"
GITHUB_APP_SLUG="your-github-app-slug"
GITHUB_APP_NAME="ExecForge"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

### 5. Install, Migrate, and Run

```bash
cd webapp
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Open `http://localhost:3000` and sign in with GitHub.

### 6. Build the SDK

```bash
cd sdk
npm install
npm run typecheck
npm run build
```

### 7. Create an Ingestion Token

Open `http://localhost:3000/onboarding`, install the GitHub App into a test repository, then create a scoped ingestion token. Copy it once — it is not stored in plaintext.

### 8. Test From Another Repository

In any project you want to observe:

```bash
npm install --save-dev @execforge/runtime
```

Add to that project's `.env`:

```env
EXECFORGE_API_URL=http://localhost:3000
EXECFORGE_API_TOKEN=exf_your_scoped_token
```

Run a command through the SDK:

```bash
npx execforge run -- "npm test --if-present"
```

Then check `http://localhost:3000/dashboard`.

---

## Runtime Configuration

The SDK resolves configuration in this priority order:

1. Action inputs: `token`, `api-url`
2. Environment variables: `EXECFORGE_API_TOKEN`, `EXECFORGE_API_URL`
3. `.env` file in the workspace root
4. Default API: `https://execforge.vercel.app`

---

## Validation

Webapp:

```bash
cd webapp
npm run lint
npm run typecheck
npm run build
```

SDK:

```bash
cd sdk
npm run typecheck
npm run build
npm pack --dry-run
```

---

## Publishing the SDK

```bash
cd sdk
npm login
npm run typecheck
npm pack --dry-run
npm publish --access public
```

After publishing, customers install via:

```bash
npm install --save-dev @execforge/runtime
```

---

## Security

- Do not commit real `.env` files.
- Rotate any GitHub OAuth secrets, GitHub App private keys, or ExecForge runtime tokens that were shared in chat or CI logs.
- Ingestion tokens are validated against repository/org scope before any telemetry is stored.
