import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadExecutionSnapshot } from "@/lib/execution-store";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { OverviewClient, OverviewEmptyOrg } from "@/components/dashboard/overview-client";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const snapshot = await loadExecutionSnapshot();
  const params = await searchParams;

  const hasOrg =
    snapshot.organizations.length > 0 &&
    snapshot.organizations.some((o) => o.repositories.length > 0);

  if (!hasOrg) {
    return (
      <div>
        <header className="dash-topbar">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-medium">Overview</span>
          </div>
        </header>
        <OverviewEmptyOrg />
      </div>
    );
  }

  const org = snapshot.organizations[0];
  const activeRepo = params.repo
    ? org.repositories.find((r) => r.id === params.repo) ?? org.repositories[0]
    : org.repositories[0];

  const repoRuns = activeRepo
    ? snapshot.workflowRuns.filter((r) => r.repositoryId === activeRepo.id)
    : [];

  // No-runs empty state (waiting for first CI run)
  if (!repoRuns.length) {
    return (
      <div>
        <header className="dash-topbar">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-medium">Overview</span>
            {activeRepo && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs font-mono text-muted-foreground">{activeRepo.name}</span>
              </>
            )}
          </div>
          <span className={`tag ${org.installationStatus === "connected" ? "tag-success" : "tag-danger"}`}>
            {org.installationStatus.replace("_", " ")}
          </span>
        </header>
        <div className="flex min-h-[calc(100vh-48px)] flex-col items-center justify-center p-8">
          <div className="w-full max-w-lg text-center space-y-6">
            <div className="flex justify-center">
              <div className="relative">
                <div className="size-16 rounded-full border border-border bg-card flex items-center justify-center">
                  <GitBranch size={22} strokeWidth={1.5} className="text-[#4ade80]" />
                </div>
                <div className="absolute inset-0 rounded-full border border-[#4ade80]/20 animate-ping" style={{ animationDuration: "2.4s" }} />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight mb-2">
                {activeRepo ? `Watching ${activeRepo.name}` : "Workspace connected"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                No runs for <span className="text-foreground font-medium font-mono">{activeRepo?.fullName ?? "this repo"}</span> yet.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card divide-y divide-border text-left">
              {[
                { label: "Workspace created", done: true },
                { label: "GitHub App installed", done: org.installationStatus === "connected" },
                { label: `${activeRepo?.name ?? "repo"} selected`, done: Boolean(activeRepo) },
                { label: "Awaiting first workflow run", done: false, pending: true },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                  {item.done ? (
                    <span className="size-3.5 rounded-full bg-[#4ade80] shrink-0" />
                  ) : item.pending ? (
                    <span className="size-3.5 rounded-full border border-muted-foreground/30 shrink-0 animate-pulse" />
                  ) : (
                    <span className="size-3.5 rounded-full border border-border shrink-0" />
                  )}
                  <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/dashboard/examples"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View workflow examples →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const prAgentHref = `/dashboard/pr-agent${params.repo ? `?repo=${params.repo}` : ""}`;
  const runsHref = `/dashboard/runs${params.repo ? `?repo=${params.repo}` : ""}`;

  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Overview</span>
          {activeRepo && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{activeRepo.fullName}</span>
            </>
          )}
        </div>
        <RefreshControls />
      </header>

      {/* Client owns all data-derived UI — hydrated from server snapshot */}
      <OverviewClient
        initialData={snapshot}
        repoId={activeRepo?.id}
        prAgentHref={prAgentHref}
        runsHref={runsHref}
      />
    </div>
  );
}
