import { loadExecutionSnapshot } from "@/lib/execution-store";
import { formatDuration } from "@/app/lib/intelligence";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import { TestsEmptyState } from "@/components/dashboard/tests-empty-state";
import { TestScaffoldLauncher } from "@/components/dashboard/test-scaffold-launcher";
import {
  AlertTriangle,
  Activity,
  FileText,
  GitBranch,
  ShieldAlert,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { TestSignal, WorkflowRun } from "@/app/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityClass(rate: number) {
  if (rate >= 30) return "tag-danger";
  if (rate >= 15) return "tag-warning";
  return "tag-muted";
}

/** Aggregate all TestSignal rows across runs into per-test totals */
function aggregateTests(signals: TestSignal[]): Array<{
  key: string;
  name: string;
  file: string;
  totalRuns: number;
  totalFailures: number;
  totalRetries: number;
  avgDurationSec: number;
  flakeRate: number;
}> {
  const map = new Map<
    string,
    {
      name: string;
      file: string;
      totalRuns: number;
      totalFailures: number;
      totalRetries: number;
      durationWeighted: number;
    }
  >();

  for (const s of signals) {
    const key = `${s.file}::${s.name}`;
    const existing = map.get(key) ?? {
      name: s.name,
      file: s.file,
      totalRuns: 0,
      totalFailures: 0,
      totalRetries: 0,
      durationWeighted: 0,
    };
    existing.totalRuns += s.runs;
    existing.totalFailures += s.failures;
    existing.totalRetries += s.retries;
    existing.durationWeighted += s.avgDurationSec * s.runs;
    map.set(key, existing);
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      file: v.file,
      totalRuns: v.totalRuns,
      totalFailures: v.totalFailures,
      totalRetries: v.totalRetries,
      avgDurationSec:
        v.totalRuns > 0 ? v.durationWeighted / v.totalRuns : 0,
      flakeRate: v.totalRuns > 0 ? (v.totalFailures / v.totalRuns) * 100 : 0,
    }))
    .filter((t) => t.totalRuns > 0)
    .sort((a, b) => b.flakeRate - a.flakeRate);
}

function aggregateTestsFromRuns(runs: WorkflowRun[]) {
  const map = new Map<
    string,
    {
      name: string;
      file: string;
      totalRuns: number;
      totalFailures: number;
      totalRetries: number;
      durationWeighted: number;
      affectedRunIds: Set<string>;
      lastSeenAt: string;
      lastStatus: WorkflowRun["status"];
    }
  >();

  for (const run of runs) {
    for (const test of run.tests) {
      const key = `${test.file}::${test.name}`;
      const existing = map.get(key) ?? {
        name: test.name,
        file: test.file,
        totalRuns: 0,
        totalFailures: 0,
        totalRetries: 0,
        durationWeighted: 0,
        affectedRunIds: new Set<string>(),
        lastSeenAt: run.startedAt,
        lastStatus: run.status,
      };
      existing.totalRuns += test.runs;
      existing.totalFailures += test.failures;
      existing.totalRetries += test.retries;
      existing.durationWeighted += test.avgDurationSec * test.runs;
      if (test.failures > 0) {
        existing.affectedRunIds.add(run.id);
      }
      if (new Date(run.startedAt).getTime() >= new Date(existing.lastSeenAt).getTime()) {
        existing.lastSeenAt = run.startedAt;
        existing.lastStatus = run.status;
      }
      map.set(key, existing);
    }
  }

  return [...map.entries()].map(([key, value]) => {
    const flakeRate = value.totalRuns > 0 ? (value.totalFailures / value.totalRuns) * 100 : 0;
    const avgDurationSec = value.totalRuns > 0 ? value.durationWeighted / value.totalRuns : 0;
    const severity =
      flakeRate >= 50 ? "critical" :
      flakeRate >= 15 ? "watch" :
      value.totalFailures > 0 ? "failures" :
      "healthy";
    return {
      key,
      name: value.name,
      file: value.file,
      totalRuns: value.totalRuns,
      totalFailures: value.totalFailures,
      totalRetries: value.totalRetries,
      avgDurationSec,
      flakeRate,
      affectedRuns: value.affectedRunIds.size,
      lastSeenAt: value.lastSeenAt,
      lastStatus: value.lastStatus,
      severity,
      impactScore: flakeRate * 1.6 + value.affectedRunIds.size * 10 + value.totalRetries * 4 + avgDurationSec,
    };
  }).sort((a, b) => b.impactScore - a.impactScore);
}

function fileBreakdown(tests: ReturnType<typeof aggregateTestsFromRuns>) {
  const map = new Map<string, { file: string; tests: number; failures: number; runs: number }>();
  for (const test of tests) {
    const current = map.get(test.file) ?? { file: test.file, tests: 0, failures: 0, runs: 0 };
    current.tests += 1;
    current.failures += test.totalFailures;
    current.runs += test.totalRuns;
    map.set(test.file, current);
  }
  return [...map.values()].sort((a, b) => b.failures - a.failures || b.tests - a.tests).slice(0, 6);
}

function percent(value: number) {
  return `${Number(value.toFixed(value >= 10 ? 0 : 1))}%`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const { repo: repoId } = await searchParams;
  const snapshot = await loadExecutionSnapshot();
  const { workflowRuns, organizations } = snapshot;

  // Resolve the active repository for the scaffold CTA
  const allRepos = organizations.flatMap((o) => o.repositories);
  const activeRepo = repoId ? (allRepos.find((r) => r.id === repoId) ?? allRepos[0]) : allRepos[0];
  const scopedRuns = activeRepo
    ? workflowRuns.filter((run) => run.repositoryId === activeRepo.id)
    : workflowRuns;

  const allSignals = scopedRuns.flatMap((r) => r.tests);
  const aggregated = aggregateTests(allSignals);
  const triageTests = aggregateTestsFromRuns(scopedRuns);
  const files = fileBreakdown(triageTests);
  const runsWithTests = scopedRuns.filter((run) => run.tests.length > 0);
  const failedRunsWithTests = runsWithTests.filter((run) => run.tests.some((test) => test.failures > 0));
  const latestRunWithTests = [...runsWithTests].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  const uniqueTestCount = aggregated.length;
  const totalRuns = aggregated.reduce((s, t) => s + t.totalRuns, 0);
  const totalFailures = aggregated.reduce((s, t) => s + t.totalFailures, 0);
  const overallFlakeRate =
    totalRuns > 0 ? ((totalFailures / totalRuns) * 100).toFixed(1) : "0";

  const highFlakeTests = aggregated.filter((t) => t.flakeRate >= 30);
  const ingestionCoverage = scopedRuns.length > 0 ? (runsWithTests.length / scopedRuns.length) * 100 : 0;
  const failureRunRate = runsWithTests.length > 0 ? (failedRunsWithTests.length / runsWithTests.length) * 100 : 0;

  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Tests</span>
          {uniqueTestCount > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs font-mono text-muted-foreground">
                {uniqueTestCount} unique tests
              </span>
            </>
          )}
        </div>
        <RefreshControls />
      </header>

      {uniqueTestCount === 0 ? (
        <div className="p-6 space-y-5">
          <TestScaffoldLauncher repositoryFullName={activeRepo?.fullName} existingTestCount={0} />
          <TestsEmptyState repositoryFullName={activeRepo?.fullName} />
        </div>
      ) : (
        <div className="p-6 space-y-5">
          <TestScaffoldLauncher repositoryFullName={activeRepo?.fullName} existingTestCount={uniqueTestCount} />

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="px-4 py-3 border-b border-border">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-medium">Signal Summary</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeRepo?.fullName ?? "All repositories"} · {runsWithTests.length} runs with parsed test output
                    </p>
                  </div>
                  <span className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono text-muted-foreground">
                    latest {latestRunWithTests ? shortDate(latestRunWithTests.startedAt) : "never"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: "Unique tests", value: uniqueTestCount.toLocaleString(), detail: `${totalRuns.toLocaleString()} observations`, icon: FileText, tone: "text-[#a5b4fc]" },
                    { label: "Failing now", value: highFlakeTests.length.toLocaleString(), detail: `${overallFlakeRate}% failure rate`, icon: ShieldAlert, tone: highFlakeTests.length ? "text-[#f87171]" : "text-[#4ade80]" },
                    { label: "Run coverage", value: percent(ingestionCoverage), detail: `${runsWithTests.length}/${scopedRuns.length} workflow runs`, icon: Activity, tone: ingestionCoverage < 70 ? "text-[#facc15]" : "text-[#4ade80]" },
                    { label: "Run failure rate", value: percent(failureRunRate), detail: `${failedRunsWithTests.length} runs impacted`, icon: TrendingUp, tone: failureRunRate > 40 ? "text-[#f87171]" : "text-muted-foreground" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase text-muted-foreground">{item.label}</p>
                        <item.icon size={13} className={item.tone} />
                      </div>
                      <p className="mt-2 text-2xl font-semibold tracking-normal">{item.value}</p>
                      <p className="mt-1 text-[11px] font-mono text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="px-4 py-3 border-b border-border">
                <CardTitle className="text-sm font-medium">What To Do Next</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="flex gap-3 rounded-lg border border-red-500/25 bg-red-500/5 p-3">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-300" />
                  <div>
                    <p className="text-sm font-medium">{highFlakeTests.length} high-risk tests need attention</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Prioritize files with repeated failures before adding more generated samples.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-lg border border-border bg-background p-3">
                  <GitBranch size={15} className="mt-0.5 shrink-0 text-[#a5b4fc]" />
                  <div>
                    <p className="text-sm font-medium">Template PRs stay available above</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      They now run with repo context that includes your existing tests, so new PRs should extend rather than duplicate obvious coverage.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr] fade-up-1">
            <Card className="bg-card border-border">
              <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Priority Queue</CardTitle>
                <span className="text-[11px] text-muted-foreground">sorted by impact</span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {triageTests.slice(0, 6).map((test, index) => (
                    <div key={test.key} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-[11px] font-mono text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{test.name}</p>
                        <p className="mt-0.5 truncate text-[11px] font-mono text-muted-foreground">{test.file}</p>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p className="text-xs font-mono font-semibold text-red-300">{test.totalFailures}</p>
                          <p className="text-[10px] text-muted-foreground">fails</p>
                        </div>
                        <span className={`tag ${severityClass(test.flakeRate)} text-[10px]`}>
                          {test.flakeRate.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Hot Files</CardTitle>
                <span className="text-[11px] text-muted-foreground">failure concentration</span>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {files.map((file) => {
                  const width = totalFailures > 0 ? Math.max(4, (file.failures / totalFailures) * 100) : 0;
                  return (
                    <div key={file.file}>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-mono text-foreground">{file.file}</span>
                        <span className="shrink-0 text-[11px] font-mono text-muted-foreground">
                          {file.failures} failures · {file.tests} tests
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-[#f87171]" style={{ width: `${width}%`, opacity: 0.85 }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>

          <Card className="bg-card border-border fade-up-2">
            <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap size={13} className="text-yellow-400" />
                Test Inventory
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">
                {uniqueTestCount} unique · sorted by impact score
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Test Name</th>
                    <th>File</th>
                    <th>Runs</th>
                    <th>Failures</th>
                    <th>Failure Rate</th>
                    <th>Impacted Runs</th>
                    <th>Last Seen</th>
                    <th>Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {triageTests.map((t) => (
                    <tr key={t.key}>
                      <td className="mono font-medium max-w-[320px] truncate">{t.name}</td>
                      <td className="mono text-muted-foreground max-w-[220px] truncate">{t.file}</td>
                      <td className="mono text-muted-foreground">{t.totalRuns}</td>
                      <td className="mono text-muted-foreground">{t.totalFailures}</td>
                      <td>
                        {t.flakeRate > 0 ? (
                          <span className={`tag ${severityClass(t.flakeRate)}`}>
                            {t.flakeRate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="tag tag-success text-[10px]">0%</span>
                        )}
                      </td>
                      <td className="mono text-muted-foreground">{t.affectedRuns}</td>
                      <td className="mono text-muted-foreground">{shortDate(t.lastSeenAt)}</td>
                      <td className="mono text-muted-foreground">
                        {formatDuration(Math.round(t.avgDurationSec))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
