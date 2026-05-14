import { loadExecutionSnapshot, loadExistingPlans } from "@/lib/execution-store";
import { estimateSimulation } from "@/app/lib/intelligence";
import { deriveOptimizations } from "@/app/lib/analysis";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Sparkles } from "lucide-react";
import { PrAgentClient } from "@/components/dashboard/pr-agent-client";
import { AIScanButton } from "@/components/dashboard/ai-scan-button";
import { isAiScanStaleForRun } from "@/lib/ai-scan-stale";


export default async function PrAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; action?: string }>;
}) {
  const { workflowRuns, organizations } = await loadExecutionSnapshot();
  const params = await searchParams;

  const org = organizations[0];
  const activeRepo = params.repo
    ? org?.repositories.find((r) => r.id === params.repo) ?? org?.repositories[0]
    : org?.repositories[0];

  // Filter to this repo only
  const repoRuns = activeRepo
    ? workflowRuns.filter((r) => r.repositoryId === activeRepo.id)
    : workflowRuns;

  if (repoRuns.length === 0) {
    return (
      <div>
        <header className="dash-topbar">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-medium">PR Agent</span>
            {activeRepo && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs font-mono text-muted-foreground">{activeRepo.fullName}</span>
              </>
            )}
          </div>
          <span className="tag tag-info font-mono text-[11px]">
            <Sparkles size={10} /> AI-powered
          </span>
        </header>
        <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
          <AlertTriangle size={24} strokeWidth={1.5} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No workflow runs for{" "}
            <span className="font-mono text-foreground">{activeRepo?.fullName ?? "this repository"}</span> yet.
            <br />
            Run at least one workflow with{" "}
            <code className="font-mono text-[11px] bg-secondary px-1 rounded">EXECFORGE_API_TOKEN</code> set.
          </p>
        </div>
      </div>
    );
  }

  // Analyze the most recent run
  const sorted = [...repoRuns].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const latestRun = sorted[0];
  const repo = activeRepo ?? org?.repositories[0];

  // Real data-driven optimization suggestions using all runs for context
  const actions = deriveOptimizations(latestRun, repoRuns);

  // Simulation: pick the applicable optimizations
  const enableRemoteCache = actions.some((a) => a.id === "remote-cache");
  const parallelizeE2E = actions.some((a) => a.id === "e2e-matrix");
  const optimizeDockerLayers = actions.some((a) => a.id === "split-docker-stages");

  const simulation = estimateSimulation(latestRun, {
    enableRemoteCache,
    splitMonolithicJobs: false,
    optimizeDockerLayers,
    parallelizeE2E,
  });

  const aiScanStale = isAiScanStaleForRun(latestRun);

  let initialExistingPlans: Awaited<ReturnType<typeof loadExistingPlans>> = [];
  if (repo) {
    initialExistingPlans = await loadExistingPlans({
      repositoryFullName: repo.fullName,
      runId: latestRun.id,
    });
  }

  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">PR Agent</span>
          {repo && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{repo.fullName}</span>
            </>
          )}
        </div>
        {repo && latestRun ? (
          <AIScanButton
            repositoryFullName={repo.fullName}
            runId={latestRun.id}
            alreadyScanned={Array.isArray(latestRun.aiScanResult)}
            showStalePrompt={aiScanStale}
          />
        ) : (
          <span className="tag tag-info font-mono text-[11px]">
            <Sparkles size={10} /> AI-powered
          </span>
        )}
      </header>

      {repo && (
        <PrAgentClient
          run={latestRun}
          allRuns={repoRuns}
          repository={repo}
          actions={actions}
          simulation={simulation}
          highlightActionId={params.action}
          initialExistingPlans={initialExistingPlans}
        />
      )}

    </div>
  );
}
