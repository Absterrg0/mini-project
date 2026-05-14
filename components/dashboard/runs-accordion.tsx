"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useRunAnalysis, useAnalyzeRun } from "@/lib/queries";
import type { WorkflowRun } from "@/app/lib/types";
import { formatDuration } from "@/app/lib/intelligence";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  MemoryStick,
  Clock,
  GitCommit,
  Server,
  AlertCircle,
  Info,
  CheckCircle2,
  Zap,
  Sparkles,
  Bot,
  Loader2,
  ClipboardList,
} from "lucide-react";

// ─── Mini SVG charts ──────────────────────────────────────────────────────────

function MiniLineChart({ values, color, height = 40, unit = "" }: { values: number[]; color: string; height?: number; unit?: string }) {
  if (values.length < 2)
    return <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>No samples</div>;
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values);
  const range = max - min || 0.01;
  const W = 400; const H = height;
  const pts = values.map((v, i) => { const x = (i / (values.length - 1)) * W; const y = H - ((v - min) / range) * (H - 6) - 3; return `${x},${y}`; }).join(" ");
  const areaClose = `${W},${H} 0,${H}`;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <defs><linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.18" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <polygon points={`${pts} ${areaClose}`} fill={`url(#grad-${color.replace("#", "")})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-0.5"><span>min {min.toFixed(1)}{unit}</span><span>max {max.toFixed(1)}{unit}</span></div>
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", minWidth: 80 }}>
      <p style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", color: color ?? "var(--foreground)" }}>{value}</p>
    </div>
  );
}

function statusFromExitCode(exitCode: number | null | undefined) { return exitCode == null ? "unknown" : exitCode === 0 ? "success" : "failed"; }
function colorFromExitCode(exitCode: number | null | undefined) { return exitCode == null ? "var(--muted-foreground)" : exitCode === 0 ? "#4ade80" : "#f87171"; }

// ─── Markdown renderer (no external dep) ─────────────────────────────────────

function boldifyHtml(s: string) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--foreground);font-weight:600">$1</strong>');
}

/** Lightweight markdown → React (no external dep). `readable` uses larger type for dialog review. */
function renderMarkdown(md: string, opts?: { readable?: boolean }): ReactNode[] {
  const readable = opts?.readable ?? false;
  const pSize = readable ? 14 : 12;
  const liSize = readable ? 14 : 12;
  const hTop = readable ? 18 : 14;
  const hSection = readable ? 16 : 13;
  const hSub = readable ? 14 : 12;
  const mono = "var(--font-mono)";

  const lines = md.split("\n");
  const nodes: ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (/^---+\s*$/.test(line)) {
      nodes.push(<hr key={key++} className="my-4 border-border/80" />);
    } else if (line.startsWith("### ")) {
      nodes.push(
        <h4
          key={key++}
          className="font-semibold text-foreground"
          style={{ fontSize: hSub, marginTop: readable ? 16 : 12, marginBottom: 4 }}
        >
          {line.slice(4)}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      nodes.push(
        <h3
          key={key++}
          className="text-foreground font-bold tracking-tight"
          style={{ fontSize: hSection, marginTop: readable ? 22 : 14, marginBottom: 6 }}
        >
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      nodes.push(
        <h2 key={key++} className="text-foreground font-bold" style={{ fontSize: hTop, marginTop: readable ? 8 : 12, marginBottom: 6 }}>
          {line.slice(2)}
        </h2>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2);
      nodes.push(
        <div key={key++} className="flex gap-2.5" style={{ marginBottom: readable ? 6 : 2 }}>
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#818cf8]" aria-hidden />
          <span
            className="min-w-0 text-muted-foreground leading-relaxed"
            style={{ fontSize: liSize, lineHeight: readable ? 1.65 : 1.6 }}
            dangerouslySetInnerHTML={{ __html: boldifyHtml(text) }}
          />
        </div>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const m = line.match(/^(\d+)\.\s(.*)$/);
      const n = m?.[1] ?? "1";
      const text = m?.[2] ?? line;
      nodes.push(
        <div key={key++} className="flex gap-3" style={{ marginBottom: readable ? 6 : 2 }}>
          <span
            className="shrink-0 font-mono text-muted-foreground tabular-nums"
            style={{ fontSize: liSize - 1, minWidth: readable ? "1.25rem" : "1rem", fontFamily: mono }}
          >
            {n}.
          </span>
          <span
            className="min-w-0 flex-1 text-muted-foreground leading-relaxed"
            style={{ fontSize: liSize, lineHeight: readable ? 1.65 : 1.6 }}
            dangerouslySetInnerHTML={{ __html: boldifyHtml(text) }}
          />
        </div>,
      );
    } else if (line.trim() === "") {
      nodes.push(<div key={key++} style={{ height: readable ? 8 : 4 }} />);
    } else {
      nodes.push(
        <p
          key={key++}
          className="text-muted-foreground leading-relaxed"
          style={{ fontSize: pSize, lineHeight: readable ? 1.7 : 1.7, marginBottom: readable ? 8 : 2 }}
          dangerouslySetInnerHTML={{ __html: boldifyHtml(line) }}
        />,
      );
    }
  }
  return nodes;
}

// ─── AI run analyze: icon stays visible; loading = spinner + ring; done = review dialog ─

function AnalyzeRunControl({
  run,
  analyzeRepositoryFullName,
}: {
  run: WorkflowRun;
  analyzeRepositoryFullName: string;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const { data: analysis } = useRunAnalysis(run.id, run.runAnalysis ?? null);
  const analyzeRun = useAnalyzeRun();
  const isPending = analyzeRun.isPending && analyzeRun.variables?.runId === run.id;
  const rf = analyzeRepositoryFullName.trim();
  const canUse = Boolean(rf);
  const hasReview = Boolean(analysis);

  function handlePrimaryClick() {
    if (!canUse || isPending) return;
    if (hasReview) {
      setReviewOpen(true);
      return;
    }
    analyzeRun.mutate({ repositoryFullName: rf, runId: run.id });
  }

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                id={`analyze-run-${run.id}`}
                type="button"
                size="icon-sm"
                variant={hasReview && !isPending ? "outline" : "default"}
                disabled={!canUse || isPending}
                onClick={handlePrimaryClick}
                className={cn(
                  "shrink-0 shadow-md transition-all",
                  isPending && canUse && "disabled:opacity-100",
                  isPending &&
                    canUse &&
                    "border-0 bg-[#6366f1] text-white ring-2 ring-[#a5b4fc]/80 ring-offset-2 ring-offset-background hover:bg-[#5b5bd6]",
                  !isPending &&
                    hasReview &&
                    "border-emerald-500/45 bg-emerald-950/35 text-emerald-50 hover:bg-emerald-900/45 hover:text-white",
                  !isPending &&
                    !hasReview &&
                    canUse &&
                    "border-0 bg-[#6366f1] text-white hover:bg-[#4f46e5] hover:text-white active:bg-[#4338ca] focus-visible:ring-2 focus-visible:ring-[#a5b4fc] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  !canUse && "border-0 bg-muted/50 text-muted-foreground opacity-70 shadow-none",
                )}
                aria-label={
                  !canUse
                    ? "Analyze run unavailable — repository not set"
                    : isPending
                      ? "Analyzing run with AI"
                      : hasReview
                        ? "Open AI run review"
                        : "Analyze run with AI"
                }
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                ) : hasReview ? (
                  <ClipboardList className="size-4" strokeWidth={2.25} aria-hidden />
                ) : (
                  <Sparkles className="size-4" strokeWidth={2.5} aria-hidden />
                )}
              </Button>
            }
          />
          <TooltipContent side="top" align="end" className="max-w-[260px] text-xs leading-relaxed">
            {!canUse ? (
              "Connect a repository to run AI analysis on this workflow run."
            ) : isPending ? (
              "Analyzing… AI is reading telemetry and job context (usually 5–15 seconds)."
            ) : hasReview ? (
              "Open the full AI review: findings, risks, and recommendations for this run."
            ) : (
              "Summarize this run with AI using telemetry and job context."
            )}
          </TooltipContent>
        </Tooltip>
      </div>

      {analysis && (
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent
            showCloseButton
            className={cn(
              "flex max-h-[min(90vh,920px)] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden border-border p-0 sm:max-w-3xl",
              "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            <div className="shrink-0 border-b border-border bg-muted/35 px-5 py-4">
              <DialogHeader className="gap-3 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="size-4 shrink-0 text-[#818cf8]" aria-hidden />
                  <DialogTitle className="text-base font-semibold leading-tight">AI run review</DialogTitle>
                </div>
                <DialogDescription className="text-left text-[13px] leading-snug text-muted-foreground">
                  Narrative generated from this run&apos;s telemetry, jobs, and tests. Use the sections below for timelines, risks, and suggested next steps.
                </DialogDescription>
                <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="rounded-md border border-border/80 bg-background/60 px-2 py-0.5">{run.branch}</span>
                  <span className="rounded-md border border-border/80 bg-background/60 px-2 py-0.5">{run.commitSha.slice(0, 7)}</span>
                  <span className="rounded-md border border-border/80 bg-background/60 px-2 py-0.5 text-foreground/90">{analysis.model}</span>
                </div>
              </DialogHeader>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/40 bg-card/30 px-5 py-5">
              <div className="max-w-none">{renderMarkdown(analysis.markdown, { readable: true })}</div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Per-run detail panel ─────────────────────────────────────────────────────

function RunDetail({
  run,
  repoFullName,
  repositoryById,
}: {
  run: WorkflowRun;
  repoFullName?: string;
  repositoryById?: Record<string, string>;
}) {
  const analyzeRepositoryFullName =
    (repoFullName?.trim() ||
      (run.repositoryId ? repositoryById?.[run.repositoryId] : undefined) ||
      "").trim();

  const rt = run.runtimeTelemetry;
  const isEnriched = run.telemetrySource === "execforge-wrapper";
  const cpuSamples = rt?.samples?.map((s) => s.cpuPct) ?? [];
  const memSamples = rt?.samples?.map((s) => s.memoryRssMb) ?? [];
  const peakCpu = cpuSamples.length ? Math.max(...cpuSamples) : null;
  const avgCpu = cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null;
  const peakMem = memSamples.length ? Math.max(...memSamples) : null;
  const avgMem = memSamples.length ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length : null;
  const captureDuration = rt?.captureStartedAt && rt?.captureFinishedAt
    ? Math.round((new Date(rt.captureFinishedAt).getTime() - new Date(rt.captureStartedAt).getTime()) / 1000) : null;

  return (
    <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 60%, transparent)", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Commit + meta + analyze (one row: details wrap, icon stays end on wide screens) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1"
          style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}
        >
          <span className="flex items-center gap-1"><GitCommit size={11} /> {run.commitSha.slice(0, 7)}</span>
          <span className="flex items-center gap-1"><Clock size={11} /> {new Date(run.startedAt).toLocaleString()}</span>
          {run.jobs.length > 0 && <span>{run.jobs.length} job{run.jobs.length !== 1 ? "s" : ""}</span>}
          {run.tests.length > 0 && <span>{run.tests.length} test{run.tests.length !== 1 ? "s" : ""}</span>}
        </div>
        <AnalyzeRunControl run={run} analyzeRepositoryFullName={analyzeRepositoryFullName} />
      </div>

      {isEnriched && rt ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label="Status" value={statusFromExitCode(rt.exitCode)} color={colorFromExitCode(rt.exitCode)} />
            {captureDuration != null && <Chip label="Capture duration" value={formatDuration(captureDuration)} />}
            {peakCpu != null && <Chip label="Peak CPU" value={`${peakCpu.toFixed(1)}%`} color={peakCpu > 80 ? "#f87171" : peakCpu > 50 ? "#facc15" : "#4ade80"} />}
            {avgCpu != null && <Chip label="Avg CPU" value={`${avgCpu.toFixed(1)}%`} />}
            {peakMem != null && <Chip label="Peak Memory" value={`${peakMem} MB`} />}
            {avgMem != null && <Chip label="Avg Memory" value={`${avgMem.toFixed(0)} MB`} />}
            {rt.machine?.cpuCount != null && <Chip label="CPU cores" value={String(rt.machine.cpuCount)} />}
            {rt.machine?.totalMemoryMb != null && <Chip label="Total RAM" value={`${Math.round(rt.machine.totalMemoryMb / 1024)} GB`} />}
          </div>
          {rt.machine && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)", flexWrap: "wrap" }}>
              <Server size={11} style={{ flexShrink: 0 }} />
              {rt.machine.os && <span>OS: {rt.machine.os}</span>}
              {rt.machine.arch && <span>Arch: {rt.machine.arch}</span>}
              {rt.machine.runnerName && <span>Runner: {rt.machine.runnerName}</span>}
              {rt.machine.runnerEnvironment && <span>Env: {rt.machine.runnerEnvironment}</span>}
            </div>
          )}
          {cpuSamples.length >= 2 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5"><Cpu size={11} className="text-muted-foreground" /><span style={{ fontSize: 11, fontWeight: 500 }}>CPU usage over time</span><span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>({cpuSamples.length} samples)</span></div>
              <MiniLineChart values={cpuSamples} color="#4ade80" height={48} unit="%" />
            </div>
          )}
          {memSamples.length >= 2 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5"><MemoryStick size={11} className="text-muted-foreground" /><span style={{ fontSize: 11, fontWeight: 500 }}>Memory RSS over time</span><span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>({memSamples.length} samples)</span></div>
              <MiniLineChart values={memSamples} color="#818cf8" height={48} unit=" MB" />
            </div>
          )}
          {rt.annotations && rt.annotations.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rt.annotations.map((ann, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: ann.level === "error" ? "#f87171" : ann.level === "warning" ? "#facc15" : "var(--muted-foreground)" }}>
                  {ann.level === "error" || ann.level === "warning" ? <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} /> : <Info size={11} style={{ flexShrink: 0, marginTop: 1 }} />}
                  <span>{ann.message}</span>
                  {ann.source && <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 10 }}>[{ann.source}]</span>}
                </div>
              ))}
            </div>
          )}
          {run.telemetryWrapperVersion && (
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>@execforge/runtime v{run.telemetryWrapperVersion}</div>
          )}
        </>
      ) : (
        <div style={{ borderRadius: 6, border: "1px solid color-mix(in srgb, #facc15 20%, transparent)", background: "color-mix(in srgb, #facc15 5%, transparent)", padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Zap size={13} style={{ color: "#facc15", flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 12, color: "var(--foreground)", fontWeight: 500, marginBottom: 3 }}>Standard webhook data only</p>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
              Add enriched telemetry to see CPU%, memory RSS, exit code, and process-level samples for this run. Set <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--secondary)", padding: "1px 4px", borderRadius: 3 }}>EXECFORGE_API_URL</code> and{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--secondary)", padding: "1px 4px", borderRadius: 3 }}>EXECFORGE_API_TOKEN</code> as GitHub secrets.
            </p>
          </div>
        </div>
      )}

      {/* Jobs */}
      {run.jobs.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Jobs</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {run.jobs.map((job) => (
              <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--font-mono)", padding: "4px 8px", background: "var(--secondary)", borderRadius: 4 }}>
                {job.status === "success" ? <CheckCircle2 size={10} style={{ color: "#4ade80" }} /> : job.status === "failed" ? <AlertCircle size={10} style={{ color: "#f87171" }} /> : <AlertCircle size={10} style={{ color: "#facc15" }} />}
                <span style={{ flex: 1, color: "var(--foreground)" }}>{job.name}</span>
                <span style={{ color: "var(--muted-foreground)" }}>{formatDuration(job.durationSec)}</span>
                {job.cacheHitRate > 0 && <span style={{ color: "var(--muted-foreground)" }}>cache {Math.round(job.cacheHitRate * 100)}%</span>}
                <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>{job.runner}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single run row ───────────────────────────────────────────────────────────

function RunRow({
  run,
  repoFullName,
  repositoryById,
}: {
  run: WorkflowRun;
  repoFullName?: string;
  repositoryById?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const isEnriched = run.telemetrySource === "execforge-wrapper";
  const { data: narrative } = useRunAnalysis(run.id, run.runAnalysis ?? null);
  const hasAnalysis = Boolean(narrative ?? run.runAnalysis);

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "grid", gridTemplateColumns: "20px 1fr 90px 90px 80px 80px 24px", alignItems: "center", gap: 12, padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", height: "auto", borderRadius: 0, justifyContent: "start" }}
      >
        {open ? <ChevronDown size={13} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />}
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--foreground)", fontWeight: 500 }}>{run.branch}</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>{formatDuration(run.totalDurationSec)}</span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{new Date(run.startedAt).toLocaleDateString()}</span>
        <span><span className={`tag ${isEnriched ? "tag-info" : "tag-muted"}`} style={{ fontSize: 10 }}>{isEnriched ? "enriched" : "standard"}</span></span>
        <span><span className={`tag ${run.status === "success" ? "tag-success" : run.status === "failed" ? "tag-danger" : "tag-warning"}`} style={{ fontSize: 10 }}>{run.status}</span></span>
        {/* AI badge */}
        <span title={hasAnalysis ? "AI analysis available" : ""}>
          {hasAnalysis && <Bot size={12} style={{ color: "#818cf8", opacity: 0.8 }} />}
        </span>
      </Button>
      {open && <RunDetail run={run} repoFullName={repoFullName} repositoryById={repositoryById} />}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function RunsAccordion({
  runs,
  repoFullName,
  repositoryById,
  emptyMessage = "No runs yet.",
}: {
  runs: WorkflowRun[];
  repoFullName?: string;
  /** When `repoFullName` is omitted, map `WorkflowRun.repositoryId` → `fullName` so analyze still works (e.g. overview). */
  repositoryById?: Record<string, string>;
  emptyMessage?: string;
}) {
  if (runs.length === 0) {
    return <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>{emptyMessage}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 90px 90px 80px 80px 24px", gap: 12, padding: "6px 16px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
        {["", "Branch", "Duration", "Date", "Telemetry", "Status", ""].map((h, i) => (
          <span key={i} style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{h}</span>
        ))}
      </div>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} repoFullName={repoFullName} repositoryById={repositoryById} />
      ))}
    </div>
  );
}
