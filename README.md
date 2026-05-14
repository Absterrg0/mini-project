# ExecForge Webapp

This is the ExecForge dashboard, API, Prisma schema, auth layer, and telemetry ingestion backend.

## Local Setup

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

### 2. Create `.env`

```bash
cd webapp
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

Generate a local auth secret:

```bash
openssl rand -hex 32
```

### 3. Configure GitHub OAuth

Create a GitHub OAuth app with:

```txt
Homepage URL: http://localhost:3000
Authorization callback URL: http://localhost:3000/api/auth/callback/github
```

Copy the OAuth client ID and secret into `webapp/.env`.

### 4. Configure GitHub App

Create a GitHub App and set:

```txt
Callback URL: http://localhost:3000/api/github/app/callback
Setup URL: http://localhost:3000/api/github/app/callback
Webhook URL: https://your-ngrok-host/api/github/webhooks
```

For local webhook testing:

```bash
ngrok http 3000
```

Select these webhook events:

```txt
Installation target
Repository
Workflow run
Workflow job
Check suite
Check run
Pull request
Push
```

Use these repository permissions:

```txt
Metadata: Read
Actions: Read
Checks: Read
Contents: Read & Write
Pull requests: Read & Write
Workflows: Read & Write
```

### 5. Install And Migrate

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

### 6. Run Locally

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Sign in with GitHub.

## Runtime Token Flow

ExecForge uses scoped ingestion tokens for SDK telemetry.

1. Connect or import an organization/repository.
2. Create an organization-scoped or repository-scoped runtime token.
3. Copy the plaintext token once.
4. Store it in the observed project as `EXECFORGE_API_TOKEN`.

For local testing, the observed project should also set:

```env
EXECFORGE_API_URL=http://localhost:3000
```

## API Endpoints Used By The SDK

```txt
POST /api/ingestion/runtime-telemetry
```

The request must include:

```txt
Authorization: Bearer exf_...
```

The token is validated against the repository/org scope before telemetry is stored.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

## Production Notes

Use production Postgres and set:

```env
DATABASE_URL="production-postgres-url"
BETTER_AUTH_SECRET="long-random-production-secret"
BETTER_AUTH_URL="https://your-execforge-domain.com"
GITHUB_CLIENT_ID="production-github-oauth-client-id"
GITHUB_CLIENT_SECRET="production-github-oauth-client-secret"
```

Run production migrations with Prisma before serving production traffic.
