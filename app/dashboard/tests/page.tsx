import { loadExecutionSnapshot } from "@/lib/execution-store";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { TestScaffoldLauncher } from "@/components/dashboard/test-scaffold-launcher";
import { TriggerWorkflowButton } from "@/components/dashboard/trigger-workflow-button";
import { RecentCiActivity, buildRecentRuns } from "@/components/dashboard/recent-ci-activity";
import { Activity, AlertTriangle, CheckCircle2, Clock, XCircle, Zap } from "lucide-react";
import type { WorkflowRun, TestSignal } from "@/app/lib/types";

// ─── Duration ──────────────────────────────────────────────────────────────────
function fmtDur(sec: number): string {
  if (sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

function pct(v: number) { return `${v.toFixed(v >= 10 ? 0 : 1)}%`; }

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

// ─── File helpers ──────────────────────────────────────────────────────────────
function bestFile(a: string, b: string): string {
  const aExt = a.includes(".");
  const bExt = b.includes(".");
  if (aExt && !bExt) return a;
  if (!aExt && bExt) return b;
  return a.length >= b.length ? a : b;
}

function displayFilename(file: string, testName: string): string {
  if (file.includes(".")) {
    const parts = file.split("/");
    return parts[parts.length - 1] ?? file;
  }
  const n = testName.toLowerCase();
  if (n.includes("random")) return "flaky-random.test.js";
  if (n.includes("timing")) return "flaky-timing.test.js";
  if (n.includes("slow")) return "execforge-slow.test.js";
  return file;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
function aggregateTests(signals: TestSignal[]) {
  const map = new Map<string, { name: string; file: string; totalRuns: number; totalFailures: number; totalRetries: number; durationWeighted: number }>();
  for (const s of signals) {
    const e = map.get(s.name) ?? { name: s.name, file: s.file, totalRuns: 0, totalFailures: 0, totalRetries: 0, durationWeighted: 0 };
    e.file = bestFile(e.file, s.file);
    e.totalRuns += s.runs; e.totalFailures += s.failures; e.totalRetries += s.retries;
    e.durationWeighted += s.avgDurationSec * s.runs;
    map.set(s.name, e);
  }
  return [...map.values()].map(v => ({
    key: v.name, name: v.name, file: v.file,
    totalRuns: v.totalRuns, totalFailures: v.totalFailures, totalRetries: v.totalRetries,
    avgDurationSec: v.totalRuns > 0 ? v.durationWeighted / v.totalRuns : 0,
    flakeRate: v.totalRuns > 0 ? (v.totalFailures / v.totalRuns) * 100 : 0,
  })).filter(t => t.totalRuns > 0).sort((a, b) => b.flakeRate - a.flakeRate);
}

function aggregateFromRuns(runs: WorkflowRun[]) {
  const map = new Map<string, { name: string; file: string; totalRuns: number; totalFailures: number; totalRetries: number; durationWeighted: number; affectedRunIds: Set<string>; lastSeenAt: string; lastStatus: WorkflowRun["status"] }>();
  for (const run of runs) {
    for (const test of run.tests) {
      const e = map.get(test.name) ?? { name: test.name, file: test.file, totalRuns: 0, totalFailures: 0, totalRetries: 0, durationWeighted: 0, affectedRunIds: new Set<string>(), lastSeenAt: run.startedAt, lastStatus: run.status };
      e.file = bestFile(e.file, test.file);
      e.totalRuns += test.runs; e.totalFailures += test.failures; e.totalRetries += test.retries;
      e.durationWeighted += test.avgDurationSec * test.runs;
      if (test.failures > 0) e.affectedRunIds.add(run.id);
      if (new Date(run.startedAt) >= new Date(e.lastSeenAt)) { e.lastSeenAt = run.startedAt; e.lastStatus = run.status; }
      map.set(test.name, e);
    }
  }
  return [...map.values()].map(v => {
    const flakeRate = v.totalRuns > 0 ? (v.totalFailures / v.totalRuns) * 100 : 0;
    const avgDurationSec = v.totalRuns > 0 ? v.durationWeighted / v.totalRuns : 0;
    return { key: v.name, name: v.name, file: v.file, totalRuns: v.totalRuns, totalFailures: v.totalFailures, totalRetries: v.totalRetries, avgDurationSec, flakeRate, affectedRuns: v.affectedRunIds.size, lastSeenAt: v.lastSeenAt, lastStatus: v.lastStatus, impactScore: flakeRate * 1.6 + v.affectedRunIds.size * 10 + v.totalRetries * 4 + avgDurationSec };
  }).sort((a, b) => b.impactScore - a.impactScore);
}

function buildTestHistory(runs: WorkflowRun[], testName: string, limit = 10): Array<"pass" | "fail" | "skip"> {
  return [...runs]
    .filter(r => r.tests.length > 0)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .slice(-limit)
    .map(run => {
      const match = run.tests.find(t => t.name === testName);
      if (!match) return "skip";
      return match.failures > 0 ? "fail" : "pass";
    });
}

// ─── Workflow mapping ──────────────────────────────────────────────────────────
function workflowForTest(file: string, testName: string): string | null {
  const base = file.split("/").pop() ?? file;
  if (base === "flaky-random.test.js" || file.endsWith("flaky-random.test.js")) {
    return ".github/workflows/test-flaky-random.yml";
  }
  if (base === "flaky-timing.test.js" || file.endsWith("flaky-timing.test.js")) {
    return ".github/workflows/test-flaky-timing.yml";
  }
  if (base === "execforge-slow.test.js" || file.endsWith("execforge-slow.test.js")) {
    return ".github/workflows/test-slow.yml";
  }
  const n = testName.toLowerCase();
  if (n.includes("random")) return ".github/workflows/test-flaky-random.yml";
  if (n.includes("timing")) return ".github/workflows/test-flaky-timing.yml";
  if (n.includes("slow")) return ".github/workflows/test-slow.yml";
  return null;
}

// ─── Inline components (server-safe) ─────────────────────────────────────────
function TestRunHistory({
  history,
  totalRuns,
  totalFailures,
}: {
  history: Array<"pass" | "fail" | "skip">;
  totalRuns: number;
  totalFailures: number;
}) {
  const passed = Math.max(0, totalRuns - totalFailures);
  const observed = history.filter((s) => s !== "skip");

  const summary =
    totalFailures > 0
      ? `${totalFailures} failed · ${passed} passed`
      : `${totalRuns} ${totalRuns === 1 ? "run" : "runs"} · all passed`;

  return (
    <div
      className="group/history relative min-w-[5.5rem]"
      title={`${summary} · last ${observed.length} CI runs (oldest → newest)`}
    >
      <div className="flex h-6 items-end gap-[2px]">
        {history.map((s, i) => (
          <div
            key={i}
            className={`w-2 shrink-0 rounded-[2px] transition-colors ${
              s === "pass"
                ? "h-full bg-emerald-500/85"
                : s === "fail"
                  ? "h-full bg-red-500/85"
                  : "h-1/3 bg-muted-foreground/15"
            }`}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-background/85 opacity-0 backdrop-blur-[2px] transition-opacity duration-150 group-hover/history:opacity-100">
        <p className="whitespace-nowrap px-1 font-mono text-[10px] leading-none text-muted-foreground">
          {totalFailures > 0 ? (
            <>
              <span className="text-red-400">{totalFailures} failed</span>
              <span className="text-muted-foreground/40"> · </span>
              <span>{passed} passed</span>
            </>
          ) : (
            <span className="text-emerald-400/90">{summary}</span>
          )}
        </p>
      </div>
    </div>
  );
}

function StatusPill({ rate, failures }: { rate: number; failures: number }) {
  if (failures === 0) return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><CheckCircle2 size={9} />passing</span>;
  if (rate >= 50) return <span className="inline-flex items-center gap-1 rounded-sm bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400"><XCircle size={9} />{pct(rate)}</span>;
  if (rate >= 15) return <span className="inline-flex items-center gap-1 rounded-sm bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400"><AlertTriangle size={9} />{pct(rate)} flaky</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-400">{pct(rate)}</span>;
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

  const runsWithTests = scopedRuns.filter(r => r.tests.length > 0);
  const failedRuns = runsWithTests.filter(r => r.tests.some(t => t.failures > 0));
  const latestRun = [...runsWithTests].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  const uniqueTestCount = aggregated.length;
  const totalRuns = aggregated.reduce((s, t) => s + t.totalRuns, 0);
  const totalFailures = aggregated.reduce((s, t) => s + t.totalFailures, 0);
  const totalRetries = aggregated.reduce((s, t) => s + t.totalRetries, 0);
  const flakeRate = totalRuns > 0 ? (totalFailures / totalRuns) * 100 : 0;
  const failureRunRate = runsWithTests.length > 0 ? (failedRuns.length / runsWithTests.length) * 100 : 0;
  const avgDurAll = totalRuns > 0 ? aggregated.reduce((s, t) => s + t.avgDurationSec * t.totalRuns, 0) / totalRuns : 0;

  const defaultBranch = activeRepo?.defaultBranch ?? "main";

  const recentRuns = buildRecentRuns(runsWithTests, 6);

  type MetricTone = "neutral" | "good" | "warn" | "bad";

  function metricValueTone(rate: number, warnAt: number, badAt: number): MetricTone {
    if (rate >= badAt) return "bad";
    if (rate >= warnAt) return "warn";
    if (rate <= 0) return "good";
    return "neutral";
  }

  function metricValueClass(tone: MetricTone) {
    if (tone === "good") return "text-[#4ade80]";
    if (tone === "warn") return "text-yellow-400";
    if (tone === "bad") return "text-[#f87171]";
    return "";
  }

  const failureTone = metricValueTone(flakeRate, 10, 30);
  const runsTone = metricValueTone(failureRunRate, 20, 40);

  const metrics = [
    {
      label: "Tests tracked",
      value: uniqueTestCount.toString(),
      sub: `${totalRuns} observations · ${runsWithTests.length} run${runsWithTests.length === 1 ? "" : "s"}`,
      icon: Zap,
      valueTone: "neutral" as MetricTone,
    },
    {
      label: "Failure rate",
      value: pct(flakeRate),
      sub: `${totalFailures} failure${totalFailures === 1 ? "" : "s"}`,
      icon: Activity,
      valueTone: failureTone,
    },
    {
      label: "Runs affected",
      value: pct(failureRunRate),
      sub: `${failedRuns.length} of ${runsWithTests.length} runs`,
      icon: CheckCircle2,
      valueTone: runsTone,
    },
    {
      label: "Avg duration",
      value: fmtDur(avgDurAll),
      sub: totalRetries > 0 ? `${totalRetries} retr${totalRetries === 1 ? "y" : "ies"}` : "no retries",
      icon: Clock,
      valueTone: (avgDurAll > 5 ? "warn" : "neutral") as MetricTone,
    },
  ];

  return (
    <div className="fade-up flex flex-col min-h-0">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Tests</span>
          {activeRepo && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">{activeRepo.fullName}</span>
            </>
          )}
          {latestRun && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs text-muted-foreground">last run {shortDate(latestRun.startedAt)}</span>
            </>
          )}
        </div>
        <RefreshControls />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-4">

          <TestScaffoldLauncher repositoryFullName={activeRepo?.fullName} existingTestCount={uniqueTestCount} />

          {uniqueTestCount > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 fade-up-1">
              {metrics.map(m => (
                <Card key={m.label} className="border-border bg-card">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-label">{m.label}</p>
                      <m.icon size={13} strokeWidth={1.5} className="text-muted-foreground" />
                    </div>
                    <p className={`stat-value ${metricValueClass(m.valueTone)}`}>{m.value}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{m.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {(recentRuns.length > 0 || triageTests.some(t => t.avgDurationSec > 0)) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {recentRuns.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Recent activity</p>
                    <span className="font-mono text-[10px] text-muted-foreground/50">newest first</span>
                  </div>
                  <RecentCiActivity runs={recentRuns} />
                </div>
              )}

              {(() => {
                const slowest = [...triageTests].filter(t => t.avgDurationSec > 0).sort((a, b) => b.avgDurationSec - a.avgDurationSec).slice(0, 5);
                if (!slowest.length) return null;
                const max = slowest[0].avgDurationSec;
                return (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                      <Clock size={13} className="text-amber-400 shrink-0" />
                      <h2 className="text-sm font-semibold">Slowest Tests</h2>
                      <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">avg {fmtDur(avgDurAll)}</span>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      {slowest.map(t => (
                        <div key={t.key}>
                          <div className="flex items-center justify-between mb-1.5 gap-3">
                            <p className="truncate text-[11px] font-medium text-foreground flex-1" title={t.name}>{t.name}</p>
                            <span className={`font-mono text-[11px] font-bold shrink-0 ${t.avgDurationSec > 3 ? "text-amber-400" : "text-muted-foreground"}`}>{fmtDur(t.avgDurationSec)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${t.avgDurationSec > 3 ? "bg-gradient-to-r from-amber-500 to-orange-400" : "bg-muted-foreground/30"}`}
                              style={{ width: `${Math.max(6, (t.avgDurationSec / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

          {/* ── Test table (full width) ── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-yellow-400" />
                <h2 className="text-sm font-semibold">Test Inventory</h2>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/60">{uniqueTestCount} tests · sorted by impact</span>
            </div>

            {triageTests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <Activity size={32} className="text-muted-foreground/30 mb-4" />
                <p className="text-sm font-medium">No test signals yet</p>
                <p className="mt-1.5 text-xs text-muted-foreground max-w-sm">Push a commit to trigger CI. The ExecForge SDK will automatically upload your JUnit XML results.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="w-1 p-0" />
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">Test · File</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">History</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">Status</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">Duration</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">Last seen</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {triageTests.map(t => {
                      const wfFile = workflowForTest(t.file, t.name);
                      const history = buildTestHistory(scopedRuns, t.name, 10);
                      const filename = displayFilename(t.file, t.name);
                      const accentColor = t.totalFailures === 0 ? "bg-emerald-500" : t.flakeRate >= 50 ? "bg-red-500" : t.flakeRate >= 15 ? "bg-orange-400" : "bg-blue-400";
                      return (
                        <tr key={t.key} className="hover:bg-muted/20 transition-colors group relative">
                          {/* Severity accent bar */}
                          <td className="w-1 p-0">
                            <div className={`h-full w-[3px] ${accentColor} opacity-80`} style={{ minHeight: "48px" }} />
                          </td>
                          <td className="px-4 py-3 max-w-[260px]">
                            <p className="truncate font-medium text-foreground text-[12px] leading-snug" title={t.name}>{t.name}</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground/60 mt-0.5" title={t.file}>{filename}</p>
                          </td>
                          <td className="px-4 py-3">
                            <TestRunHistory
                              history={history}
                              totalRuns={t.totalRuns}
                              totalFailures={t.totalFailures}
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <StatusPill rate={t.flakeRate} failures={t.totalFailures} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono">
                            <span className={t.avgDurationSec > 3 ? "text-amber-400" : "text-muted-foreground"}>
                              {fmtDur(t.avgDurationSec)}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground/50 whitespace-nowrap">
                            {shortDate(t.lastSeenAt)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {activeRepo?.fullName && wfFile ? (
                              <TriggerWorkflowButton
                                repositoryFullName={activeRepo.fullName}
                                workflowId={wfFile}
                                defaultBranch={defaultBranch}
                                label="Rerun"
                              />
                            ) : (
                              <span className="text-[10px] text-muted-foreground/20">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
