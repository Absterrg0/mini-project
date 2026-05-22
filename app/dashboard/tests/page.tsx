import { loadExecutionSnapshot } from "@/lib/execution-store";
import { formatDuration } from "@/app/lib/intelligence";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { TestScaffoldLauncher } from "@/components/dashboard/test-scaffold-launcher";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  Flame,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import type { TestSignal, WorkflowRun } from "@/app/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function percent(v: number) {
  return `${Number(v.toFixed(v >= 10 ? 0 : 1))}%`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function aggregateTests(signals: TestSignal[]) {
  const map = new Map<string, {
    name: string; file: string;
    totalRuns: number; totalFailures: number; totalRetries: number; durationWeighted: number;
  }>();
  for (const s of signals) {
    const key = `${s.file}::${s.name}`;
    const e = map.get(key) ?? { name: s.name, file: s.file, totalRuns: 0, totalFailures: 0, totalRetries: 0, durationWeighted: 0 };
    e.totalRuns += s.runs; e.totalFailures += s.failures; e.totalRetries += s.retries;
    e.durationWeighted += s.avgDurationSec * s.runs;
    map.set(key, e);
  }
  return [...map.entries()].map(([key, v]) => ({
    key, name: v.name, file: v.file,
    totalRuns: v.totalRuns, totalFailures: v.totalFailures, totalRetries: v.totalRetries,
    avgDurationSec: v.totalRuns > 0 ? v.durationWeighted / v.totalRuns : 0,
    flakeRate: v.totalRuns > 0 ? (v.totalFailures / v.totalRuns) * 100 : 0,
  })).filter(t => t.totalRuns > 0).sort((a, b) => b.flakeRate - a.flakeRate);
}

function aggregateFromRuns(runs: WorkflowRun[]) {
  const map = new Map<string, {
    name: string; file: string;
    totalRuns: number; totalFailures: number; totalRetries: number; durationWeighted: number;
    affectedRunIds: Set<string>; lastSeenAt: string; lastStatus: WorkflowRun["status"];
  }>();
  for (const run of runs) {
    for (const test of run.tests) {
      const key = `${test.file}::${test.name}`;
      const e = map.get(key) ?? {
        name: test.name, file: test.file,
        totalRuns: 0, totalFailures: 0, totalRetries: 0, durationWeighted: 0,
        affectedRunIds: new Set<string>(), lastSeenAt: run.startedAt, lastStatus: run.status,
      };
      e.totalRuns += test.runs; e.totalFailures += test.failures; e.totalRetries += test.retries;
      e.durationWeighted += test.avgDurationSec * test.runs;
      if (test.failures > 0) e.affectedRunIds.add(run.id);
      if (new Date(run.startedAt) >= new Date(e.lastSeenAt)) { e.lastSeenAt = run.startedAt; e.lastStatus = run.status; }
      map.set(key, e);
    }
  }
  return [...map.entries()].map(([key, v]) => {
    const flakeRate = v.totalRuns > 0 ? (v.totalFailures / v.totalRuns) * 100 : 0;
    const avgDurationSec = v.totalRuns > 0 ? v.durationWeighted / v.totalRuns : 0;
    return {
      key, name: v.name, file: v.file,
      totalRuns: v.totalRuns, totalFailures: v.totalFailures, totalRetries: v.totalRetries,
      avgDurationSec, flakeRate,
      affectedRuns: v.affectedRunIds.size,
      lastSeenAt: v.lastSeenAt, lastStatus: v.lastStatus,
      severity: flakeRate >= 50 ? "critical" : flakeRate >= 15 ? "watch" : v.totalFailures > 0 ? "failures" : "healthy" as string,
      impactScore: flakeRate * 1.6 + v.affectedRunIds.size * 10 + v.totalRetries * 4 + avgDurationSec,
    };
  }).sort((a, b) => b.impactScore - a.impactScore);
}

function fileBreakdown(tests: ReturnType<typeof aggregateFromRuns>) {
  const map = new Map<string, { file: string; tests: number; failures: number; runs: number }>();
  for (const t of tests) {
    const c = map.get(t.file) ?? { file: t.file, tests: 0, failures: 0, runs: 0 };
    c.tests += 1; c.failures += t.totalFailures; c.runs += t.totalRuns;
    map.set(t.file, c);
  }
  return [...map.values()].sort((a, b) => b.failures - a.failures || b.tests - a.tests).slice(0, 8);
}

function SeverityBadge({ rate, failures }: { rate: number; failures: number }) {
  if (failures === 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
      <CheckCircle2 size={9} /> passing
    </span>
  );
  if (rate >= 50) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400 ring-1 ring-red-500/25">
      <XCircle size={9} /> {rate.toFixed(0)}% fail
    </span>
  );
  if (rate >= 15) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20">
      <AlertTriangle size={9} /> {rate.toFixed(0)}% flaky
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400 ring-1 ring-blue-500/20">
      {rate.toFixed(0)}% fail
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TestsPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo: repoId } = await searchParams;
  const snapshot = await loadExecutionSnapshot();
  const { workflowRuns, organizations } = snapshot;

  const allRepos = organizations.flatMap(o => o.repositories);
  const activeRepo = repoId ? (allRepos.find(r => r.id === repoId) ?? allRepos[0]) : allRepos[0];
  const scopedRuns = activeRepo ? workflowRuns.filter(r => r.repositoryId === activeRepo.id) : workflowRuns;

  const allSignals = scopedRuns.flatMap(r => r.tests);
  const aggregated = aggregateTests(allSignals);
  const triageTests = aggregateFromRuns(scopedRuns);
  const files = fileBreakdown(triageTests);

  const runsWithTests = scopedRuns.filter(r => r.tests.length > 0);
  const failedRunsWithTests = runsWithTests.filter(r => r.tests.some(t => t.failures > 0));
  const latestRun = [...runsWithTests].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  const uniqueTestCount = aggregated.length;
  const totalRuns = aggregated.reduce((s, t) => s + t.totalRuns, 0);
  const totalFailures = aggregated.reduce((s, t) => s + t.totalFailures, 0);
  const totalRetries = aggregated.reduce((s, t) => s + t.totalRetries, 0);
  const flakeRate = totalRuns > 0 ? (totalFailures / totalRuns) * 100 : 0;
  const ingestionCoverage = scopedRuns.length > 0 ? (runsWithTests.length / scopedRuns.length) * 100 : 0;
  const failureRunRate = runsWithTests.length > 0 ? (failedRunsWithTests.length / runsWithTests.length) * 100 : 0;

  const criticalTests = triageTests.filter(t => t.flakeRate >= 50);
  const watchTests = triageTests.filter(t => t.flakeRate >= 15 && t.flakeRate < 50);
  const healthyTests = triageTests.filter(t => t.totalFailures === 0);

  return (
    <div className="fade-up flex flex-col min-h-0">
      {/* Top bar */}
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Tests</span>
          {uniqueTestCount > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{uniqueTestCount} unique · {runsWithTests.length} instrumented runs</span>
            </>
          )}
        </div>
        <RefreshControls />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-5">

          {/* Template PR launcher */}
          <TestScaffoldLauncher repositoryFullName={activeRepo?.fullName} existingTestCount={uniqueTestCount} />

          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Unique Tests",
                value: uniqueTestCount.toLocaleString(),
                sub: `${totalRuns.toLocaleString()} total observations`,
                icon: FileCode2,
                accent: "text-violet-400",
                border: "border-violet-500/20",
                bg: "bg-violet-500/5",
              },
              {
                label: "Overall Failure Rate",
                value: percent(flakeRate),
                sub: `${totalFailures} failures across all runs`,
                icon: flakeRate > 15 ? TrendingUp : TrendingDown,
                accent: flakeRate >= 30 ? "text-red-400" : flakeRate >= 10 ? "text-amber-400" : "text-emerald-400",
                border: flakeRate >= 30 ? "border-red-500/20" : flakeRate >= 10 ? "border-amber-500/20" : "border-emerald-500/20",
                bg: flakeRate >= 30 ? "bg-red-500/5" : flakeRate >= 10 ? "bg-amber-500/5" : "bg-emerald-500/5",
              },
              {
                label: "CI Coverage",
                value: percent(ingestionCoverage),
                sub: `${runsWithTests.length} of ${scopedRuns.length} runs instrumented`,
                icon: Activity,
                accent: ingestionCoverage < 50 ? "text-amber-400" : "text-emerald-400",
                border: ingestionCoverage < 50 ? "border-amber-500/20" : "border-emerald-500/20",
                bg: ingestionCoverage < 50 ? "bg-amber-500/5" : "bg-emerald-500/5",
              },
              {
                label: "Runs With Failures",
                value: percent(failureRunRate),
                sub: `${failedRunsWithTests.length} runs had test failures`,
                icon: failureRunRate > 30 ? Flame : CheckCircle2,
                accent: failureRunRate > 30 ? "text-red-400" : "text-emerald-400",
                border: failureRunRate > 30 ? "border-red-500/20" : "border-emerald-500/20",
                bg: failureRunRate > 30 ? "bg-red-500/5" : "bg-emerald-500/5",
              },
            ].map(item => (
              <div key={item.label} className={`rounded-xl border ${item.border} ${item.bg} p-4`}>
                <div className="flex items-start justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  <item.icon size={14} className={item.accent} />
                </div>
                <p className={`mt-3 text-3xl font-bold tracking-tight ${item.accent}`}>{item.value}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{item.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Health breakdown + Slowest test ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Health summary */}
            <div className="col-span-2 rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-semibold">Test Health Breakdown</h2>
                <span className="text-[11px] text-muted-foreground font-mono">{latestRun ? `latest ${shortDate(latestRun.startedAt)}` : "no data"}</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                {[
                  { label: "Critical", count: criticalTests.length, color: "text-red-400", bg: "bg-red-500/10", icon: XCircle },
                  { label: "Flaky", count: watchTests.length, color: "text-amber-400", bg: "bg-amber-500/10", icon: AlertTriangle },
                  { label: "Passing", count: healthyTests.length, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
                ].map(s => (
                  <div key={s.label} className="flex flex-col items-center justify-center py-6 gap-2">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${s.bg}`}>
                      <s.icon size={18} className={s.color} />
                    </div>
                    <p className={`text-3xl font-bold ${s.color}`}>{s.count}</p>
                    <p className="text-xs font-medium text-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              {/* Mini bar */}
              {uniqueTestCount > 0 && (
                <div className="px-5 pb-4">
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className="bg-red-500 transition-all" style={{ width: `${(criticalTests.length / uniqueTestCount) * 100}%` }} />
                    <div className="bg-amber-500 transition-all" style={{ width: `${(watchTests.length / uniqueTestCount) * 100}%` }} />
                    <div className="bg-emerald-500 transition-all" style={{ width: `${(healthyTests.length / uniqueTestCount) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>

            {/* Slow Tests Analysis */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-400" />
                  <h2 className="text-sm font-semibold">Slowest Tests</h2>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  avg {totalRuns > 0 ? formatDuration(Math.round(aggregated.reduce((s, t) => s + t.avgDurationSec * t.totalRuns, 0) / totalRuns)) : "—"}
                </span>
              </div>
              {(() => {
                const sorted = [...triageTests].sort((a, b) => b.avgDurationSec - a.avgDurationSec).slice(0, 5);
                const maxDur = sorted[0]?.avgDurationSec ?? 1;
                return sorted.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center px-6">
                    <Clock size={28} className="text-muted-foreground/40 mb-2" />
                    <p className="text-xs text-muted-foreground">No duration data yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {sorted.map((t) => (
                      <div key={t.key} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="truncate text-[11px] font-medium text-foreground max-w-[200px]" title={t.name}>{t.name}</p>
                          <span className={`text-[11px] font-mono font-semibold ${t.avgDurationSec > 3 ? "text-amber-400" : t.avgDurationSec > 1 ? "text-blue-400" : "text-emerald-400"}`}>
                            {formatDuration(Math.round(t.avgDurationSec))}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${t.avgDurationSec > 3 ? "bg-gradient-to-r from-amber-500 to-orange-400" : t.avgDurationSec > 1 ? "bg-blue-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.max(4, (t.avgDurationSec / maxDur) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 truncate text-[10px] font-mono text-muted-foreground">{t.file}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}  
            </div>
          </div>

          {/* ── Priority Queue + Hot Files ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Priority queue */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Flame size={14} className="text-orange-400" />
                  <h2 className="text-sm font-semibold">Priority Queue</h2>
                </div>
                <span className="text-[11px] text-muted-foreground">by impact score</span>
              </div>
              {triageTests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <CheckCircle2 size={32} className="text-emerald-400 mb-3" />
                  <p className="text-sm font-medium">All tests passing</p>
                  <p className="text-xs text-muted-foreground mt-1">No tests need immediate attention.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {triageTests.slice(0, 7).map((test, i) => (
                    <div key={test.key} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-mono text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-foreground">{test.name}</p>
                        <p className="mt-0.5 truncate text-[10px] font-mono text-muted-foreground">{test.file}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className="text-[11px] font-mono text-muted-foreground">{test.totalRuns}r · {test.totalFailures}f</p>
                          <p className="text-[10px] text-muted-foreground">{formatDuration(Math.round(test.avgDurationSec))} avg</p>
                        </div>
                        <SeverityBadge rate={test.flakeRate} failures={test.totalFailures} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hot files */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <FileCode2 size={14} className="text-violet-400" />
                  <h2 className="text-sm font-semibold">File Failure Concentration</h2>
                </div>
                <span className="text-[11px] text-muted-foreground">{files.length} files</span>
              </div>
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <CheckCircle2 size={32} className="text-emerald-400 mb-3" />
                  <p className="text-sm font-medium">No file hotspots</p>
                  <p className="text-xs text-muted-foreground mt-1">Failures are not concentrated in any file.</p>
                </div>
              ) : (
                <div className="px-5 py-4 space-y-4">
                  {files.map(file => {
                    const width = totalFailures > 0 ? Math.max(3, (file.failures / totalFailures) * 100) : 0;
                    const failRate = file.runs > 0 ? (file.failures / file.runs) * 100 : 0;
                    return (
                      <div key={file.file}>
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <span className="truncate text-[11px] font-mono text-foreground flex-1">{file.file}</span>
                          <div className="flex items-center gap-3 shrink-0 text-[10px] font-mono text-muted-foreground">
                            <span>{file.tests} test{file.tests !== 1 ? "s" : ""}</span>
                            <span className={file.failures > 0 ? "text-red-400 font-semibold" : "text-emerald-400"}>{file.failures} failures</span>
                            <span>{percent(failRate)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400 transition-all" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Full Test Inventory ── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-yellow-400" />
                <h2 className="text-sm font-semibold">Test Inventory</h2>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">{uniqueTestCount} tests · sorted by impact</span>
            </div>
            {triageTests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <Activity size={36} className="text-muted-foreground/40 mb-4" />
                <p className="text-sm font-semibold text-foreground">No test signals yet</p>
                <p className="mt-1.5 text-xs text-muted-foreground max-w-sm">
                  Push a commit to trigger CI. The ExecForge SDK finish action will automatically detect and upload your JUnit XML results.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Test Name", "File", "Status", "Runs", "Failures", "Retries", "Avg Duration", "Impacted Runs", "Last Seen"].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {triageTests.map(t => (
                      <tr key={t.key} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-4 py-3 max-w-[280px]">
                          <p className="truncate font-medium text-foreground text-[12px]" title={t.name}>{t.name}</p>
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="truncate font-mono text-muted-foreground" title={t.file}>{t.file}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <SeverityBadge rate={t.flakeRate} failures={t.totalFailures} />
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{t.totalRuns}</td>
                        <td className="px-4 py-3 font-mono whitespace-nowrap">
                          <span className={t.totalFailures > 0 ? "text-red-400 font-semibold" : "text-emerald-400"}>{t.totalFailures}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{t.totalRetries}</td>
                        <td className="px-4 py-3 font-mono whitespace-nowrap">
                          <span className={t.avgDurationSec > 5 ? "text-amber-400" : "text-muted-foreground"}>
                            {formatDuration(Math.round(t.avgDurationSec))}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{t.affectedRuns}</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap text-[10px]">{shortDate(t.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
