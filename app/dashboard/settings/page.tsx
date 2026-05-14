import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadExecutionSnapshot } from "@/lib/execution-store";
import { listIngestionTokens } from "@/lib/ingestion-tokens";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { SettingsClientPage } from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { organizations } = await loadExecutionSnapshot();
  const org = organizations[0];

  const githubAppSlug = process.env.GITHUB_APP_SLUG;
  const installUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new${org ? `?state=${org.id}` : ""}`
    : null;
  const configureUrl = org?.installationUrl ?? installUrl;
  const tokens = org ? await listIngestionTokens({ organizationId: org.id }) : [];

  return (
    <div className="fade-up flex flex-col h-screen overflow-hidden">
      <header className="dash-topbar shrink-0">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Settings</span>
          {org && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{org.name}</span>
            </>
          )}
        </div>
        <RefreshControls />
      </header>

      <SettingsClientPage
        data={{
          userName: session.user.name ?? "",
          userEmail: session.user.email ?? "",
          orgName: org?.name,
          orgPlan: org?.plan,
          repoCount: org?.repositories.length ?? 0,
          installationStatus: org?.installationStatus,
          installationRepositorySelection: org?.installationRepositorySelection,
          configureUrl: configureUrl ?? null,
          organizationId: org?.id,
          initialTokens: tokens,
          connected: org?.installationStatus === "connected",
        }}
      />
    </div>
  );
}
