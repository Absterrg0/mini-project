# ExecForge Webapp

The Next.js application that forms the core of ExecForge. It provides the analytics dashboard, GitHub App integration, telemetry ingestion API, authentication, and AI-powered PR agent.

---

## Architecture

```
webapp/
├── app/
│   ├── dashboard/          # Main analytics UI (runs, tests, PR agent)
│   │   ├── page.tsx        # Overview: run history, failure clusters
│   │   ├── tests/          # Test telemetry analytics
│   │   │   └── page.tsx    # Metrics, recent activity, slowest tests, inventory + rerun
│   │   ├── runs/           # Individual run drilldown
│   │   ├── pr-agent/       # AI optimization PR generation
│   │   ├── settings/       # Token management
│   │   └── ingestion/      # Ingestion pipeline health
│   ├── onboarding/         # GitHub App install + token creation
│   ├── sign-in/            # GitHub OAuth page
│   └── api/
│       ├── ingestion/
│       │   └── runtime-telemetry/  # SDK upload endpoint (POST)
│       └── github/
│           ├── webhooks/           # GitHub App webhook handler (POST)
│           └── app/callback/       # GitHub App OAuth callback
│
├── lib/
│   ├── execution-store.ts   # All Prisma read/write operations and data mapping
│   ├── github-app.ts        # GitHub App JWT, webhook verification, installation API
│   ├── telemetry-analytics.ts  # Coverage status and failure cluster analysis
│   ├── telemetry-contract.ts   # Telemetry schema validation
│   ├── ingestion-tokens.ts     # Scoped token creation, hashing, validation
│   ├── ingestion-auth.ts       # Token auth middleware for ingestion routes
│   ├── queries.ts              # Dashboard data query layer
│   ├── branch-guard.ts         # Filters ExecForge-internal branches from display
│   ├── auth.ts                 # Better Auth server config
│   └── prisma.ts               # Singleton Prisma client
│
└── prisma/
    └── schema.prisma            # Postgres data model
```

---

## Key API Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ingestion/runtime-telemetry` | SDK telemetry upload. Requires `Authorization: Bearer exf_...` |
| `POST` | `/api/github/webhooks` | GitHub App webhook receiver. Verifies HMAC signature. |
| `GET/POST` | `/api/github/app/callback` | GitHub App OAuth installation callback |
| `GET/POST` | `/api/auth/*` | Better Auth — sign in, session, sign out |
| `POST` | `/api/github/dispatch` | Trigger `workflow_dispatch` for a repo workflow (Tests page **Rerun**). Session auth + GitHub App installation token. |

---

## Tests dashboard (`/dashboard/tests`)

The Tests page is the primary surface for per-test CI quality:

| Section | Purpose |
|---|---|
| Metric cards | Tests tracked, failure rate, runs affected, avg duration |
| Test scaffold launcher | Add flaky/failing/slow/e2e/unit workflows via PR |
| Recent activity | Last 6 CI runs with failing test names and relative times |
| Slowest tests | Top tests by average duration |
| Test inventory | All tests sorted by impact; history bars; per-test **Rerun** |

**Rerun** requires the GitHub App installation to grant **Actions: Read and write**. After updating permissions in the GitHub App settings, accept the upgrade on each installation. Workflows must declare `on: workflow_dispatch`.

**Components**: `components/dashboard/recent-ci-activity.tsx`, `components/dashboard/trigger-workflow-button.tsx`, `components/dashboard/test-scaffold-launcher.tsx`

---

## Ingestion

Two independent paths write to the same `WorkflowRunSnapshot` row, with the following priority:

1. **SDK path** (`POST /api/ingestion/runtime-telemetry`) — enriched telemetry from the `@execforge/runtime` action. Includes CPU/memory samples, JUnit test results, and accurate job status. Validated against a scoped org/repo token.

2. **GitHub webhook path** (`POST /api/github/webhooks`) — triggered by `workflow_run` events. Fetches job/step data from the GitHub API. Never overwrites existing SDK telemetry — if the SDK has already written enriched data, the webhook update is a no-op for telemetry fields.

Idempotency keys prevent duplicate writes from repeated webhook deliveries or retries.

---

## Local Setup

### 1. Start Postgres

```bash
docker run --name execforge-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=execforge \
  -p 5432:5432 \
  -d postgres:16
```

Resume an existing container:

```bash
docker start execforge-postgres
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Required values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/execforge?schema=public"
BETTER_AUTH_SECRET="replace-with-openssl-rand-hex-32"
BETTER_AUTH_URL="http://localhost:3000"
GITHUB_CLIENT_ID="your-github-oauth-client-id"
GITHUB_CLIENT_SECRET="your-github-oauth-client-secret"
GITHUB_APP_ID="your-github-app-id"
GITHUB_APP_SLUG="your-github-app-slug"
GITHUB_APP_NAME="ExecForge"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET="replace-with-openssl-rand-hex-32"
```

Generate secrets:

```bash
openssl rand -hex 32
```

### 3. Configure GitHub OAuth

Create an OAuth App at `GitHub → Settings → Developer settings → OAuth Apps`:

```
Homepage URL:             http://localhost:3000
Authorization callback:   http://localhost:3000/api/auth/callback/github
```

Copy client ID and secret into `.env`.

### 4. Configure GitHub App

Create a GitHub App at `GitHub → Settings → Developer settings → GitHub Apps`.

For local webhook delivery, run a tunnel first:

```bash
ngrok http 3000
```

App settings:

```
Callback URL:   http://localhost:3000/api/github/app/callback
Setup URL:      http://localhost:3000/api/github/app/callback
Webhook URL:    https://your-ngrok-host/api/github/webhooks
Webhook secret: same value as GITHUB_APP_WEBHOOK_SECRET
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

Generate a private key, then store it in `GITHUB_APP_PRIVATE_KEY` with `\n` newline escapes.

### 5. Install and Migrate

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

### 6. Run Locally

```bash
npm run dev
```

Open `http://localhost:3000` and sign in with GitHub.

---

## Runtime Token Flow

ExecForge uses scoped ingestion tokens — separate from OAuth — to authenticate SDK uploads:

1. Go to `http://localhost:3000/onboarding`.
2. Install the GitHub App into the target organization or repository.
3. Create an organization-scoped or repository-scoped runtime token.
4. Copy the plaintext token **once** (it is hashed on the server after creation).
5. Store it as `EXECFORGE_API_TOKEN` in the observed project's repository secrets.

For local SDK testing, also set `EXECFORGE_API_URL=http://localhost:3000` in the observed project's `.env`.

---

## Data Model (Prisma)

Key models:

| Model | Purpose |
|---|---|
| `ExecutionOrganization` | GitHub org with GitHub App installation metadata |
| `ExecutionRepository` | Individual repo, telemetry mode, and aggregate CI metrics |
| `WorkflowRunSnapshot` | Single CI run — status, duration, jobs, tests, runtime telemetry |
| `IngestionEvent` | Audit log of every telemetry write attempt (idempotent upsert) |
| `IngestionCheckpoint` | Pipeline health for each org — sync cursor, events processed |
| `RuntimeIngestionToken` | Hashed scoped tokens for SDK authentication |
| `OptimizationPlanRecord` | AI-generated PR plans linked to a specific run |

---

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

---

## Production Notes

- Use a production Postgres instance and set `DATABASE_URL` to a TLS connection string.
- Set `BETTER_AUTH_URL` to your production domain.
- Run `npm run prisma:migrate` before deploying new schema changes.
- The GitHub App webhook URL must be reachable from `api.github.com` — no tunnels in production.
- The AI PR agent requires an additional `OPENAI_API_KEY` or equivalent environment variable; see `lib/ai-provider.ts`.
