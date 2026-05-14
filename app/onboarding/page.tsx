import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadExecutionSnapshot } from "@/lib/execution-store";
import { auth } from "@/lib/auth";
import { buildTelemetryCoverage } from "@/lib/telemetry-analytics";
import OnboardingClient from "./onboarding-client";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; error?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const justInstalled = params.installed === "1";
  const installError = params.error ?? null;

  // When the user just came back from GitHub (justInstalled), bypass the
  // unstable_cache entirely and query the DB directly — the callback route
  // already synced the repos but the cache revalidation may not have propagated
  // yet on the same request cycle. In the normal case we still use the cache.
  const snapshot = await loadExecutionSnapshot(
    justInstalled ? { refreshGitHubInstallations: true } : {},
  );
  const coverageByOrgId = Object.fromEntries(
    snapshot.organizations.map((org) => [
      org.id,
      buildTelemetryCoverage(org, snapshot.workflowRuns),
    ]),
  );

  const githubAppSlug = process.env.GITHUB_APP_SLUG;
  const githubAppName = process.env.GITHUB_APP_NAME ?? "ExecForge";

  // The GitHub username from their OAuth sign-in (e.g. "Absterrg0")
  const githubUsername = session.user.name ?? "your GitHub account";

  // Install URL goes to GitHub App installation page.
  // No state param needed — syncInstallationRepositories in the callback
  // auto-creates the org from the GitHub installation owner.
  const installUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null;

  return (
    <OnboardingClient
      organizations={snapshot.organizations}
      pipelines={snapshot.pipelines}
      coverageByOrgId={coverageByOrgId}
      githubAppName={githubAppName}
      githubUsername={githubUsername}
      installUrl={installUrl}
      justInstalled={justInstalled}
      installError={installError}
    />
  );
}
