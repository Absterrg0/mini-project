import { loadExecutionSnapshot } from "@/lib/execution-store";
import { detectFlakyTests, formatDuration } from "@/app/lib/intelligence";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshControls } from "@/components/dashboard/refresh-controls";
import {
  AlertTriangle,
  CheckCircle,
  FlaskConical,
  RotateCcw,
  Timer,
  TrendingDown,
  Zap,
} from "lucide-react";
import type { TestSignal } from "@/app/lib/types";

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TestsPage() {
  const { workflowRuns } = await loadExecutionSnapshot();

  const flakyTests = detectFlakyTests(workflowRuns);
  const allSignals = workflowRuns.flatMap((r) => r.tests);
  const aggregated = aggregateTests(allSignals);

  const uniqueTestCount = aggregated.length;
  const totalRuns = aggregated.reduce((s, t) => s + t.totalRuns, 0);
  const totalFailures = aggregated.reduce((s, t) => s + t.totalFailures, 0);
  const totalRetries = aggregated.reduce((s, t) => s + t.totalRetries, 0);
  const overallFlakeRate =
    totalRuns > 0 ? ((totalFailures / totalRuns) * 100).toFixed(1) : "0";
  const slowestTest = [...aggregated].sort(
    (a, b) => b.avgDurationSec - a.avgDurationSec
  )[0];
  const mostRetried = [...aggregated].sort(
    (a, b) => b.totalRetries - a.totalRetries
  )[0];

  const highFlakeTests = aggregated.filter((t) => t.flakeRate >= 30);
  const warnFlakeTests = aggregated.filter(
    (t) => t.flakeRate >= 15 && t.flakeRate < 30
  );
  const healthyTests = aggregated.filter((t) => t.flakeRate < 15);

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
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="size-12 rounded-full border border-border bg-card flex items-center justify-center mb-2">
            <FlaskConical size={20} strokeWidth={1.5} className="text-muted-foreground" />
          </div>
          <p className="font-medium">No test data yet</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Ingest workflow runs that include test signals to see flake detection,
            retry analysis, and duration tracking here.
          </p>
        </div>
      ) : (
        <div className="p-6 space-y-5">

          {/* ── Scorecard ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 fade-up-1">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-label">Unique Tests</p>
                  <FlaskConical size={13} strokeWidth={1.5} className="text-muted-foreground" />
                </div>
                <p className="stat-value">{uniqueTestCount}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">
                  {totalRuns.toLocaleString()} total runs
                </p>
              </CardContent>
            </Card>

            <Card className={`border ${highFlakeTests.length > 0 ? "border-[#f87171]/30 bg-[#f87171]/5" : "bg-card border-border"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-label">Flaky Tests</p>
                  <AlertTriangle
                    size={13}
                    strokeWidth={1.5}
                    className={highFlakeTests.length > 0 ? "text-[#f87171]" : "text-muted-foreground"}
                  />
                </div>
                <p className={`stat-value ${highFlakeTests.length > 0 ? "text-[#f87171]" : ""}`}>
                  {flakyTests.length}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">
                  {overallFlakeRate}% overall rate
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-label">Total Retries</p>
                  <RotateCcw size={13} strokeWidth={1.5} className="text-muted-foreground" />
                </div>
                <p className="stat-value">{totalRetries.toLocaleString()}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground font-mono">
                  {totalFailures} failures masked
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-label">Slowest Test</p>
                  <Timer size={13} strokeWidth={1.5} className="text-muted-foreground" />
                </div>
                <p className="stat-value">
                  {slowestTest ? formatDuration(Math.round(slowestTest.avgDurationSec)) : "—"}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground font-mono truncate">
                  {slowestTest?.name ?? "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ── Health breakdown + most retried ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 fade-up-2">

            {/* Health distribution */}
            <Card className="bg-card border-border">
              <CardHeader className="px-4 py-3 border-b border-border">
                <CardTitle className="text-sm font-medium">Health Distribution</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {[
                  { label: "High flake (≥30%)", count: highFlakeTests.length, color: "#f87171", bg: "bg-[#f87171]" },
                  { label: "Warning (15–30%)", count: warnFlakeTests.length, color: "#facc15", bg: "bg-yellow-400" },
                  { label: "Healthy (<15%)", count: healthyTests.length, color: "#4ade80", bg: "bg-[#4ade80]" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-xs font-mono font-medium">{item.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.bg}`}
                        style={{
                          width: uniqueTestCount > 0 ? `${(item.count / uniqueTestCount) * 100}%` : "0%",
                          opacity: 0.8,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-border">
                  {highFlakeTests.length === 0 ? (
                    <div className="flex items-center gap-2 text-[#4ade80] text-xs">
                      <CheckCircle size={12} />
                      All tests within acceptable flake bounds
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[#f87171] text-xs">
                      <AlertTriangle size={12} />
                      {highFlakeTests.length} test{highFlakeTests.length !== 1 ? "s" : ""} need quarantine
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Most retried */}
            <Card className="bg-card border-border lg:col-span-2">
              <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Highest Retry Cost</CardTitle>
                <span className="text-[11px] text-muted-foreground">top 5 by retry count</span>
              </CardHeader>
              <CardContent className="p-0">
                {mostRetried ? (
                  <div className="divide-y divide-border">
                    {[...aggregated]
                      .sort((a, b) => b.totalRetries - a.totalRetries)
                      .slice(0, 5)
                      .map((t) => (
                        <div key={t.key} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{t.name}</p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                              {t.file}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-xs font-mono font-semibold">{t.totalRetries}</p>
                              <p className="text-[10px] text-muted-foreground">retries</p>
                            </div>
                            <span className={`tag ${severityClass(t.flakeRate)} text-[10px]`}>
                              {t.flakeRate.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground">No retry data.</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Full flaky test intelligence table ── */}
          <Card className="bg-card border-border fade-up-2">
            <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap size={13} className="text-yellow-400" />
                Flaky Test Intelligence
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">
                {flakyTests.length} test{flakyTests.length !== 1 ? "s" : ""} flagged · sorted by confidence drop
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {flakyTests.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Test Name</th>
                      <th>File</th>
                      <th>Flake Rate</th>
                      <th>Retries / Fail</th>
                      <th>Avg Duration</th>
                      <th>Confidence Drop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flakyTests.map((t) => (
                      <tr key={`${t.file}-${t.name}`}>
                        <td className="mono font-medium">{t.name}</td>
                        <td className="mono text-muted-foreground">{t.file}</td>
                        <td>
                          <span className={`tag ${severityClass(t.flakeRate)}`}>
                            {t.flakeRate}%
                          </span>
                        </td>
                        <td className="mono text-muted-foreground">
                          {t.retriesPerFailure.toFixed(1)}×
                        </td>
                        <td className="mono text-muted-foreground">
                          {/* look up avg duration from aggregated */}
                          {(() => {
                            const agg = aggregated.find(
                              (a) => a.name === t.name && a.file === t.file
                            );
                            return agg
                              ? formatDuration(Math.round(agg.avgDurationSec))
                              : "—";
                          })()}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#f87171]"
                                style={{
                                  width: `${Math.min(100, t.confidenceDropScore)}%`,
                                  opacity: 0.7,
                                }}
                              />
                            </div>
                            <span className="mono text-muted-foreground text-[11px]">
                              {t.confidenceDropScore}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 flex flex-col items-center gap-2 text-center">
                  <CheckCircle size={20} strokeWidth={1.5} className="text-[#4ade80]" />
                  <p className="text-sm font-medium">No flaky tests detected</p>
                  <p className="text-xs text-muted-foreground">
                    All ingested test signals are within acceptable failure thresholds.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── All tests table ── */}
          <Card className="bg-card border-border fade-up-3">
            <CardHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingDown size={13} className="text-muted-foreground" />
                All Tests
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">
                {uniqueTestCount} unique · sorted by flake rate
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
                    <th>Flake Rate</th>
                    <th>Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.map((t) => (
                    <tr key={t.key}>
                      <td className="mono font-medium max-w-[220px] truncate">{t.name}</td>
                      <td className="mono text-muted-foreground max-w-[160px] truncate">{t.file}</td>
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
