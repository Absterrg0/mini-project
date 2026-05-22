import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { WorkflowRun } from "@/app/lib/types";

export type RecentRunRow = {
  id: string;
  startedAt: string;
  branch: string;
  status: WorkflowRun["status"];
  totalDurationSec: number;
  workflowName: string;
  failedTests: number;
  totalTests: number;
  failingNames: string[];
};

export function buildRecentRuns(runs: WorkflowRun[], limit = 6): RecentRunRow[] {
  return [...runs]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)
    .map((r) => {
      const failing = r.tests.filter((t) => t.failures > 0);
      return {
        id: r.id,
        startedAt: r.startedAt,
        branch: r.branch,
        status: r.status,
        totalDurationSec: r.totalDurationSec,
        workflowName: r.workflowName,
        failedTests: failing.length,
        totalTests: r.tests.length,
        failingNames: failing.map((t) => t.name),
      };
    });
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fmtDur(sec: number): string {
  if (sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return shortDate(iso);
}

function runOutcome(run: RecentRunRow): "pass" | "fail" | "degraded" {
  if (run.failedTests > 0) return "fail";
  if (run.status === "degraded") return "degraded";
  return "pass";
}

function OutcomeIcon({ outcome }: { outcome: "pass" | "fail" | "degraded" }) {
  if (outcome === "fail") return <XCircle size={14} className="shrink-0 text-red-400" />;
  if (outcome === "degraded") return <AlertTriangle size={14} className="shrink-0 text-amber-400" />;
  return <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />;
}

export function RecentCiActivity({ runs }: { runs: RecentRunRow[] }) {
  if (!runs.length) return null;

  const latest = runs[0];
  const latestOutcome = runOutcome(latest);
  const failedInWindow = runs.filter((r) => r.failedTests > 0).length;

  return (
    <div className="divide-y divide-border/50">
      {latestOutcome === "fail" && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2.5">
          <p className="text-[11px] font-medium text-red-400">Latest run failed</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {latest.failedTests} of {latest.totalTests} tests · {latest.branch} · {relativeTime(latest.startedAt)}
          </p>
        </div>
      )}

      <ul className="max-h-[280px] overflow-y-auto">
        {runs.map((run) => {
          const outcome = runOutcome(run);
          const showFailures = run.failingNames.slice(0, 2);
          const moreFailures = run.failingNames.length - showFailures.length;

          return (
            <li
              key={run.id}
              className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/20"
            >
              <OutcomeIcon outcome={outcome} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[12px] font-medium text-foreground" title={run.workflowName}>
                    {run.workflowName}
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                    {relativeTime(run.startedAt)}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {run.branch}
                  <span className="text-muted-foreground/40"> · </span>
                  {fmtDur(run.totalDurationSec)}
                  {run.totalTests > 0 && (
                    <>
                      <span className="text-muted-foreground/40"> · </span>
                      {outcome === "pass" ? (
                        <span className="text-emerald-400/80">{run.totalTests} tests ok</span>
                      ) : (
                        <span className="text-red-400">
                          {run.failedTests}/{run.totalTests} failed
                        </span>
                      )}
                    </>
                  )}
                </p>
                {showFailures.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {showFailures.map((name) => (
                      <span
                        key={name}
                        className="max-w-[12rem] truncate rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-300/90"
                        title={name}
                      >
                        {name}
                      </span>
                    ))}
                    {moreFailures > 0 && (
                      <span className="font-mono text-[9px] text-muted-foreground/60">+{moreFailures} more</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {failedInWindow > 0 && runs.length > 1 && (
        <p className="px-4 py-2 font-mono text-[10px] text-muted-foreground/50">
          {failedInWindow} of {runs.length} recent runs had test failures
        </p>
      )}
    </div>
  );
}
