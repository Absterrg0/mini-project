"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
} from "lucide-react";

// ─── Mini SVG charts ──────────────────────────────────────────────────────────

function MiniLineChart({
  values,
  color,
  height = 40,
  unit = "",
}: {
  values: number[];
  color: string;
  height?: number;
  unit?: string;
}) {
  if (values.length < 2)
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No samples
      </div>
    );

  const max = Math.max(...values, 0.01);
  const min = Math.min(...values);
  const range = max - min || 0.01;
  const W = 400;
  const H = height;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 6) - 3;
      return `${x},${y}`;
    })
    .join(" ");

  const areaClose = `${((values.length - 1) / (values.length - 1)) * W},${H} 0,${H}`;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <defs>
          <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${pts} ${areaClose}`}
          fill={`url(#grad-${color.replace("#", "")})`}
        />
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-0.5">
        <span>
          min {min.toFixed(1)}
          {unit}
        </span>
        <span>
          max {max.toFixed(1)}
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function Chip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "var(--secondary)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 12px",
        minWidth: 80,
      }}
    >
      <p style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", color: color ?? "var(--foreground)" }}>
        {value}
      </p>
    </div>
  );
}

function statusFromExitCode(exitCode: number | null | undefined) {
  if (exitCode == null) return "unknown";
  return exitCode === 0 ? "success" : "failed";
}

function colorFromExitCode(exitCode: number | null | undefined) {
  if (exitCode == null) return "var(--muted-foreground)";
  return exitCode === 0 ? "#4ade80" : "#f87171";
}

// ─── Per-run detail panel ─────────────────────────────────────────────────────

function RunDetail({ run }: { run: WorkflowRun }) {
  const rt = run.runtimeTelemetry;
  const isEnriched = run.telemetrySource === "execforge-wrapper";

  // Compute peak/avg from samples
  const cpuSamples = rt?.samples?.map((s) => s.cpuPct) ?? [];
  const memSamples = rt?.samples?.map((s) => s.memoryRssMb) ?? [];
  const peakCpu = cpuSamples.length ? Math.max(...cpuSamples) : null;
  const avgCpu = cpuSamples.length
    ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length
    : null;
  const peakMem = memSamples.length ? Math.max(...memSamples) : null;
  const avgMem = memSamples.length
    ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length
    : null;

  const captureDuration =
    rt?.captureStartedAt && rt?.captureFinishedAt
      ? Math.round(
          (new Date(rt.captureFinishedAt).getTime() - new Date(rt.captureStartedAt).getTime()) /
            1000,
        )
      : null;

  return (
    <div
      style={{
        padding: "14px 16px",
        borderTop: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--card) 60%, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Commit + meta row ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--muted-foreground)",
        }}
      >
        <span className="flex items-center gap-1">
          <GitCommit size={11} /> {run.commitSha.slice(0, 7)}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} /> {new Date(run.startedAt).toLocaleString()}
        </span>
        {run.jobs.length > 0 && <span>{run.jobs.length} job{run.jobs.length !== 1 ? "s" : ""}</span>}
        {run.tests.length > 0 && <span>{run.tests.length} test{run.tests.length !== 1 ? "s" : ""}</span>}
      </div>

      {isEnriched && rt ? (
        <>
          {/* ── Process stats chips ── */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip
              label="Status"
              value={statusFromExitCode(rt.exitCode)}
              color={colorFromExitCode(rt.exitCode)}
            />
            {captureDuration != null && (
              <Chip label="Capture duration" value={formatDuration(captureDuration)} />
            )}
            {peakCpu != null && (
              <Chip label="Peak CPU" value={`${peakCpu.toFixed(1)}%`} color={peakCpu > 80 ? "#f87171" : peakCpu > 50 ? "#facc15" : "#4ade80"} />
            )}
            {avgCpu != null && <Chip label="Avg CPU" value={`${avgCpu.toFixed(1)}%`} />}
            {peakMem != null && <Chip label="Peak Memory" value={`${peakMem} MB`} />}
            {avgMem != null && <Chip label="Avg Memory" value={`${avgMem.toFixed(0)} MB`} />}
            {rt.machine?.cpuCount != null && (
              <Chip label="CPU cores" value={String(rt.machine.cpuCount)} />
            )}
            {rt.machine?.totalMemoryMb != null && (
              <Chip label="Total RAM" value={`${Math.round(rt.machine.totalMemoryMb / 1024)} GB`} />
            )}
          </div>

          {/* ── Machine info ── */}
          {rt.machine && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--muted-foreground)",
                flexWrap: "wrap",
              }}
            >
              <Server size={11} style={{ flexShrink: 0 }} />
              {rt.machine.os && <span>OS: {rt.machine.os}</span>}
              {rt.machine.arch && <span>Arch: {rt.machine.arch}</span>}
              {rt.machine.runnerName && <span>Runner: {rt.machine.runnerName}</span>}
              {rt.machine.runnerEnvironment && <span>Env: {rt.machine.runnerEnvironment}</span>}
            </div>
          )}

          {/* ── CPU profile chart ── */}
          {cpuSamples.length >= 2 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Cpu size={11} className="text-muted-foreground" />
                <span style={{ fontSize: 11, fontWeight: 500 }}>CPU usage over time</span>
                <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                  ({cpuSamples.length} samples)
                </span>
              </div>
              <MiniLineChart values={cpuSamples} color="#4ade80" height={48} unit="%" />
            </div>
          )}

          {/* ── Memory profile chart ── */}
          {memSamples.length >= 2 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <MemoryStick size={11} className="text-muted-foreground" />
                <span style={{ fontSize: 11, fontWeight: 500 }}>Memory RSS over time</span>
                <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                  ({memSamples.length} samples)
                </span>
              </div>
              <MiniLineChart values={memSamples} color="#818cf8" height={48} unit=" MB" />
            </div>
          )}

          {/* ── Annotations ── */}
          {rt.annotations && rt.annotations.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rt.annotations.map((ann, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 11,
                    color:
                      ann.level === "error"
                        ? "#f87171"
                        : ann.level === "warning"
                        ? "#facc15"
                        : "var(--muted-foreground)",
                  }}
                >
                  {ann.level === "error" ? (
                    <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : ann.level === "warning" ? (
                    <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <Info size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                  )}
                  <span>{ann.message}</span>
                  {ann.source && (
                    <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                      [{ann.source}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Wrapper version ── */}
          {run.telemetryWrapperVersion && (
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
              @execforge/runtime v{run.telemetryWrapperVersion}
            </div>
          )}
        </>
      ) : (
        /* ── Standard (non-enriched) run ── */
        <div
          style={{
            borderRadius: 6,
            border: "1px solid color-mix(in srgb, #facc15 20%, transparent)",
            background: "color-mix(in srgb, #facc15 5%, transparent)",
            padding: "10px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Zap size={13} style={{ color: "#facc15", flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 12, color: "var(--foreground)", fontWeight: 500, marginBottom: 3 }}>
              Standard webhook data only
            </p>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
              Add enriched telemetry to see CPU%, memory RSS, exit code, and process-level
              samples for this run. Set <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--secondary)", padding: "1px 4px", borderRadius: 3 }}>EXECFORGE_API_URL</code> and{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--secondary)", padding: "1px 4px", borderRadius: 3 }}>EXECFORGE_API_TOKEN</code> as GitHub secrets.
            </p>
          </div>
        </div>
      )}

      {/* ── Jobs breakdown ── */}
      {run.jobs.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Jobs</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {run.jobs.map((job) => (
              <div
                key={job.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "4px 8px",
                  background: "var(--secondary)",
                  borderRadius: 4,
                }}
              >
                {job.status === "success" ? (
                  <CheckCircle2 size={10} style={{ color: "#4ade80" }} />
                ) : job.status === "failed" ? (
                  <AlertCircle size={10} style={{ color: "#f87171" }} />
                ) : (
                  <AlertCircle size={10} style={{ color: "#facc15" }} />
                )}
                <span style={{ flex: 1, color: "var(--foreground)" }}>{job.name}</span>
                <span style={{ color: "var(--muted-foreground)" }}>{formatDuration(job.durationSec)}</span>
                {job.cacheHitRate > 0 && (
                  <span style={{ color: "var(--muted-foreground)" }}>
                    cache {Math.round(job.cacheHitRate * 100)}%
                  </span>
                )}
                <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>{job.runner}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single run row (accordion trigger + detail panel) ────────────────────────

function RunRow({ run }: { run: WorkflowRun }) {
  const [open, setOpen] = useState(false);
  const isEnriched = run.telemetrySource === "execforge-wrapper";

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Trigger */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "20px 1fr 90px 90px 80px 80px",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          height: "auto",
          borderRadius: 0,
          justifyContent: "start",
        }}
      >
        {open ? (
          <ChevronDown size={13} style={{ color: "var(--muted-foreground)" }} />
        ) : (
          <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />
        )}
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--foreground)", fontWeight: 500 }}>
          {run.branch}
        </span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>
          {formatDuration(run.totalDurationSec)}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
          {new Date(run.startedAt).toLocaleDateString()}
        </span>
        <span>
          <span
            className={`tag ${isEnriched ? "tag-info" : "tag-muted"}`}
            style={{ fontSize: 10 }}
          >
            {isEnriched ? "enriched" : "standard"}
          </span>
        </span>
        <span>
          <span
            className={`tag ${
              run.status === "success"
                ? "tag-success"
                : run.status === "failed"
                ? "tag-danger"
                : "tag-warning"
            }`}
            style={{ fontSize: 10 }}
          >
            {run.status}
          </span>
        </span>
      </Button>

      {/* Detail panel */}
      {open && <RunDetail run={run} />}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function RunsAccordion({
  runs,
  emptyMessage = "No runs yet.",
}: {
  runs: WorkflowRun[];
  emptyMessage?: string;
}) {
  if (runs.length === 0) {
    return (
      <div
        style={{
          padding: "24px 16px",
          textAlign: "center",
          fontSize: 13,
          color: "var(--muted-foreground)",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "20px 1fr 90px 90px 80px 80px",
          gap: 12,
          padding: "6px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--secondary)",
        }}
      >
        {["", "Branch", "Duration", "Date", "Telemetry", "Status"].map((h) => (
          <span
            key={h}
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}
