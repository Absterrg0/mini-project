import { headers } from "next/headers";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { recordIngestionEvent } from "@/lib/execution-store";
import {
  GitHubAppConfigurationError,
  syncInstallationRepositories,
} from "@/lib/github-app";
import { getCleanErrorMessage } from "@/lib/api-errors";

/**
 * GitHub App post-installation callback.
 *
 * GitHub redirects here after the user installs the App, sending:
 *   ?installation_id=<id>&setup_action=install|update
 *
 * We use this as the "Setup URL" in GitHub App settings, NOT as the OAuth
 * callback URL. The two are different GitHub concepts.
 *
 * On success  → redirect to /onboarding?installed=1  (server renders fresh repos)
 * On error    → redirect to /onboarding?error=<reason>
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { searchParams } = new URL(request.url);
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action") ?? "install";

  if (!installationId) {
    redirect("/onboarding?error=missing_installation_id");
  }

  try {
    // 1. Fetch and upsert all repositories accessible to this installation
    const repositories = await syncInstallationRepositories(installationId);

    // 2. Bust the Next.js snapshot cache so repos appear immediately on redirect
    // Next.js 16: revalidateTag requires a second profile argument; { expire: 0 }
    // forces immediate expiry of all entries tagged "execution-snapshot".
    revalidateTag("execution-snapshot", { expire: 0 });

    // 3. Record for audit / analytics
    await recordIngestionEvent({
      eventType: "github.app_installation_callback",
      source: "github-app",
      status: "processed",
      idempotencyKey: `github-app-callback:${installationId}:${setupAction}`,
      payload: { installationId, setupAction, repositoryCount: repositories.length },
    });
  } catch (error) {
    const message = getCleanErrorMessage(error, "GitHub App installation sync failed.");

    // Best-effort audit log — don't let this throw
    await recordIngestionEvent({
      eventType: "github.app_installation_callback",
      source: "github-app",
      status: "rejected",
      idempotencyKey: `github-app-callback:${installationId}:${setupAction}`,
      error: message,
      payload: { installationId, setupAction },
    }).catch(() => undefined);

    if (error instanceof GitHubAppConfigurationError) {
      redirect(`/onboarding?error=${encodeURIComponent("GitHub App is not fully configured — check APP_ID and PRIVATE_KEY.")}`);
    }

    redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  // Success — server redirect; the page will re-run and fetch fresh repos from DB
  redirect("/onboarding?installed=1");
}
