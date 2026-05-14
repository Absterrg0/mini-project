"use client";

import { useSnapshot } from "@/lib/queries";
import { formatDuration } from "@/app/lib/intelligence";
import { detectAbnormalities, deriveOptimizations } from "@/app/lib/analysis";
import Link from "next/link";
import {
  ArrowUpRight, Zap, Clock, CheckCircle, Activity,
  AlertTriangle, AlertCircle, ShieldCheck,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunsAccordion } from "@/components/dashboard/runs-accordion";
import {
  DurationLineChart,
  ProcessMetricsLineChart,
  StatusBreakdownChart,
} from "@/components/dashboard/overview-charts";
import type { ExecutionSnapshot } from "@/lib/execution-store";
import type { WorkflowRun } from "@/app/lib/types";

function deriveStats(runs: WorkflowRun[]) {
  if (!runs.length) return { total: 0, failed: 0, successRate: 0, avgDuration: 0, p95Duration: 0 };
  const total = runs.length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const successRate = Math.round(((total - failed) / total) * 100);
  const avgDuration = Math.round(runs.reduce((s, r) => s + r.totalDurationSec, 0) / total);
  const sorted = [...runs].sort((a, b) => a.totalDurationSec - b.totalDurationSec);
  const p95Duration =
    sorted[Math.floor(sorted.length * 0.95)]?.totalDurationSec ??
    sorted[sorted.length - 1]?.totalDurationSec ?? 0;
  return { total, failed, successRate, avgDuration, p95Duration };
}

export function OverviewClient({
  initialData,
  repoId,
  prAgentHref,
  runsHref,
}: {
  initialData: ExecutionSnapshot;
  repoId?: string;
  prAgentHref: string;
  runsHref: string;
}) {
  const { data = initialData } = useSnapshot({
    initialData,
    initialDataUpdatedAt: Date.now(),
  });

  const org = data.organizations[0];
  const allRuns = data.workflowRuns;
  const repoRuns = repoId ? allRuns.filter((r) => r.repositoryId === repoId) : allRuns;

  const stats = deriveStats(repoRuns);
  const chronoRuns = [...repoRuns].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const recentRuns = [...repoRuns]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 10);

  const repositoryById =
    org?.repositories?.length ?
      Object.fromEntries(org.repositories.map((r) => [r.id, r.fullName]))
    : undefined;

  const hasEnriched = repoRuns.some((r) => r.telemetrySource === "execforge-wrapper");
  const enrichedRuns = chronoRuns.filter((r) => r.telemetrySource === "execforge-wrapper");

  const successCount = repoRuns.filter((r) => r.status === "success").length;
  const failedCount = repoRuns.filter((r) => r.status === "failed").length;
  const degradedCount = repoRuns.filter((r) => r.status === "degraded").length;

  const durationPoints = chronoRuns.map((r) => ({
    value: r.totalDurationSec,
    status: r.status,
    label: r.branch,
  }));

  const abnormalities = detectAbnormalities(repoRuns);
  
  // Calculate full PR Agent optimization queue size for the latest run
  const latestRun = recentRuns[0];
  let optimizationCount = 0;
  let worstAbnormality = abnormalities[0];

  if (latestRun) {
    const rulesActions = deriveOptimizations(latestRun, repoRuns);
    const aiActionsLength = Array.isArray(latestRun.aiScanResult) ? latestRun.aiScanResult.length : 0;
    
    // The optimization queue deduplicates AI actions, but for a quick count we can just sum or dedupe exactly.
    // It's fine to sum them here for the overview.
    optimizationCount = rulesActions.length + aiActionsLength;
  }

  // If there are optimizations but no "worst abnormality", we can forge one for the UI link
  if (optimizationCount > 0 && !worstAbnormality) {
    worstAbnormality = {
      id: "optimizations-available",
      severity: "warning",
      title: "Optimizations available in queue",
    } as any;
  }

  // Empty org state — handled by parent server component, so org is always defined here
  if (!org) return null;

  return (
    <div className="p-6 space-y-5">
      {/* Scorecard row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 fade-up-1">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-label">Total Runs</p>
              <Activity size={13} strokeWidth={1.5} className="text-muted-foreground" />
            </div>
            <p className="stat-value">{stats.total}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">{stats.failed} failed</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-label">Success Rate</p>
              <CheckCircle size={13} strokeWidth={1.5} className="text-muted-foreground" />
            </div>
            <p className={`stat-value ${stats.successRate >= 90 ? "text-[#4ade80]" : stats.successRate >= 70 ? "text-yellow-400" : "text-[#f87171]"}`}>
              {stats.successRate}%
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">
              {stats.failed} failure{stats.failed !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-label">Avg Duration</p>
              <Clock size={13} strokeWidth={1.5} className="text-muted-foreground" />
            </div>
            <p className="stat-value">{formatDuration(stats.avgDuration)}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">
              p95: {formatDuration(stats.p95Duration)}
            </p>
          </CardContent>
        </Card>

        {worstAbnormality ? (
          <Link href={prAgentHref} className="block group">
            <Card className={`border h-full transition-colors ${worstAbnormality.severity === "danger" ? "border-[#f87171]/30 bg-[#f87171]/5 hover:border-[#f87171]/50" : "border-yellow-400/30 bg-yellow-400/5 hover:border-yellow-400/50"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-label">Abnormalities</p>
                  {worstAbnormality.severity === "danger"
                    ? <AlertCircle size={13} className="text-[#f87171]" />
                    : <AlertTriangle size={13} className="text-yellow-400" />}
                </div>
                <p className={`stat-value ${worstAbnormality.severity === "danger" ? "text-[#f87171]" : "text-yellow-400"}`}>
                  {optimizationCount > 0 ? optimizationCount : abnormalities.length}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground font-mono truncate">{worstAbnormality.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  View in PR Agent <ArrowUpRight size={9} />
                </p>
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Card className="border-[#4ade80]/20 bg-[#4ade80]/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-label">Abnormalities</p>
                <ShieldCheck size={13} className="text-[#4ade80]" />
              </div>
              <p className="stat-value text-[#4ade80]">None</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">All systems nominal</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 fade-up-2">
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="px-4 py-3 border-b border-border">
            <CardTitle className="text-sm font-medium">Run Duration History</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <DurationLineChart points={durationPoints} />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="px-4 py-3 border-b border-border">
            <CardTitle className="text-sm font-medium">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <StatusBreakdownChart success={successCount} failed={failedCount} degraded={degradedCount} />
          </CardContent>
        </Card>
      </div>

      {hasEnriched && enrichedRuns.length > 0 && (
        <Card className="bg-card border-border fade-up-2">
          <CardHeader className="px-4 py-3 border-b border-border">
            <CardTitle className="text-sm font-medium">Peak CPU &amp; Memory per Run</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ProcessMetricsLineChart runs={enrichedRuns} />
          </CardContent>
        </Card>
      )}



      {/* Recent runs */}
      <Card className="bg-card border-border fade-up-3">
        <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Recent Runs</CardTitle>
          <Link href={runsHref} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            View all <ArrowUpRight size={11} />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <RunsAccordion
            runs={recentRuns}
            repositoryById={repositoryById}
            emptyMessage="No runs for this repository yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Empty states (server-rendered, no data needed) ────────────────────────────

export function OverviewEmptyOrg() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="size-12 rounded-full border border-border bg-card flex items-center justify-center mb-2">
        <Zap size={20} strokeWidth={1.5} className="text-muted-foreground" />
      </div>
      <p className="font-medium">No execution data yet</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Connect an organization and install the GitHub App to start ingesting workflow data.
      </p>
    </div>
  );
}
