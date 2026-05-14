import { loadExecutionSnapshot } from "@/lib/execution-store";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { RunsClient } from "@/components/dashboard/runs-client";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const snapshot = await loadExecutionSnapshot();
  const params = await searchParams;

  const org = snapshot.organizations[0];
  const activeRepo = params.repo
    ? org?.repositories.find((r) => r.id === params.repo) ?? org?.repositories[0]
    : org?.repositories[0];

  const totalRuns = params.repo
    ? snapshot.workflowRuns.filter((r) => r.repositoryId === activeRepo?.id).length
    : snapshot.workflowRuns.length;

  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Runs</span>
          {activeRepo && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{activeRepo.fullName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">{totalRuns} total</span>
          <RefreshControls />
        </div>
      </header>

      {/* Client component owns the live data from React Query */}
      <RunsClient
        initialData={snapshot}
        repoId={activeRepo?.id}
        repoFullName={activeRepo?.fullName}
      />
    </div>
  );
}
