"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import type { WorkflowRun } from "@/app/lib/types";
import { formatDuration } from "@/app/lib/intelligence";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const STATUS_COLORS = {
  success: "#4ade80",
  failed: "#f87171",
  degraded: "#facc15",
} as const;

type DurationPoint = {
  value: number;
  status: string;
  label: string;
};

const durationChartConfig = {
  duration: {
    label: "Duration",
    color: "#4ade80",
  },
  average: {
    label: "Average",
    color: "#94a3b8",
  },
} satisfies ChartConfig;

export function DurationLineChart({ points }: { points: DurationPoint[] }) {
  const avg =
    points.reduce((sum, point) => sum + point.value, 0) /
    Math.max(1, points.length);

  const data = points.map((point, index) => ({
    index,
    branch: point.label,
    status: point.status,
    duration: point.value,
    average: avg,
  }));

  return (
    <ChartContainer
      config={durationChartConfig}
      className="h-[160px] w-full aspect-auto"
    >
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillDuration" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4ade80" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillAverage" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="branch"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
        />
        <YAxis hide domain={[0, "dataMax + 5"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) => {
                if (name === "duration")
                  return `${formatDuration(Number(value))} · ${String(item.payload?.status ?? "")}`;
                return formatDuration(Number(value));
              }}
            />
          }
        />
        {points.length > 1 && (
          <Area
            type="monotone"
            dataKey="average"
            stroke="#94a3b8"
            strokeDasharray="4 4"
            strokeWidth={1.25}
            fill="url(#fillAverage)"
            dot={false}
            activeDot={false}
          />
        )}
        <Area
          type="natural"
          dataKey="duration"
          stroke="#4ade80"
          strokeWidth={2}
          fill="url(#fillDuration)"
          dot={(props) => {
            const payload = props.payload as {
              status: keyof typeof STATUS_COLORS;
            };
            return (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={3}
                fill={STATUS_COLORS[payload.status] ?? STATUS_COLORS.degraded}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            );
          }}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

const metricsChartConfig = {
  cpu: {
    label: "CPU %",
    color: "#4ade80",
  },
  memory: {
    label: "Memory MB",
    color: "#818cf8",
  },
} satisfies ChartConfig;

export function ProcessMetricsLineChart({ runs }: { runs: WorkflowRun[] }) {
  const filtered = runs.filter((run) => (run.runtimeTelemetry?.samples?.length ?? 0) > 0);

  const data = filtered.map((run, index) => {
    const samples = run.runtimeTelemetry?.samples ?? [];
    return {
      index,
      label: run.branch,
      runLabel: `${run.branch} · ${formatDuration(run.totalDurationSec)}`,
      cpu: samples.length ? Math.max(...samples.map((s) => s.cpuPct)) : 0,
      memory: samples.length ? Math.max(...samples.map((s) => s.memoryRssMb)) : 0,
    };
  });

  if (!data.length) return null;

  // Compute normalized domains with padding so charts never appear as flat lines
  const cpuValues = data.map((d) => d.cpu);
  const memValues = data.map((d) => d.memory);

  function normalizedDomain(values: number[], hardMin = 0, hardMax?: number): [number, number] {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    // If all values are identical (flat line), add ±20% padding around value
    const pad = range < 0.01 ? Math.max(max * 0.2, 1) : range * 0.4;
    const lo = Math.max(hardMin, min - pad);
    const hi = hardMax != null ? Math.min(hardMax, max + pad) : max + pad;
    return [lo, hi];
  }

  const cpuDomain = normalizedDomain(cpuValues, 0, 100);
  const memDomain = normalizedDomain(memValues, 0);

  return (
    <div className="space-y-2">
      <ChartContainer
        config={metricsChartConfig}
        className="h-[145px] w-full aspect-auto"
      >
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="fillCpu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillMemory" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
          />
          <YAxis yAxisId="cpu" hide domain={cpuDomain} />
          <YAxis
            yAxisId="memory"
            hide
            orientation="right"
            domain={memDomain}
          />
          <ChartTooltip
            cursor={false}
            labelFormatter={(_, payload) =>
              (payload as unknown as Array<{ payload?: { runLabel?: string } }>)?.[0]?.payload?.runLabel ?? ""
            }
            content={
              <ChartTooltipContent
                formatter={(value, name) =>
                  name === "cpu"
                    ? `${Number(value).toFixed(1)}%`
                    : `${Number(value).toFixed(0)} MB`
                }
              />
            }
          />
          <Area
            yAxisId="cpu"
            type="natural"
            dataKey="cpu"
            stroke="#4ade80"
            strokeWidth={2}
            fill="url(#fillCpu)"
            dot={{ r: 3, strokeWidth: 1.5, fill: "#4ade80", stroke: "var(--card)" }}
            activeDot={{ r: 4 }}
          />
          <Area
            yAxisId="memory"
            type="natural"
            dataKey="memory"
            stroke="#818cf8"
            strokeWidth={2}
            fill="url(#fillMemory)"
            dot={{ r: 3, strokeWidth: 1.5, fill: "#818cf8", stroke: "var(--card)" }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ChartContainer>
      {/* inline legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground font-mono">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#4ade80" }} />
          CPU %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#818cf8" }} />
          Memory MB
        </span>
      </div>
    </div>
  );
}


const statusChartConfig = {
  success: {
    label: "Success",
    color: STATUS_COLORS.success,
  },
  failed: {
    label: "Failed",
    color: STATUS_COLORS.failed,
  },
  degraded: {
    label: "Degraded",
    color: STATUS_COLORS.degraded,
  },
} satisfies ChartConfig;

export function StatusBreakdownChart({
  success,
  failed,
  degraded,
}: {
  success: number;
  failed: number;
  degraded: number;
}) {
  const total = success + failed + degraded || 1;
  const data = [
    { name: "success", value: success, fill: STATUS_COLORS.success },
    { name: "failed", value: failed, fill: STATUS_COLORS.failed },
    { name: "degraded", value: degraded, fill: STATUS_COLORS.degraded },
  ].filter((item) => item.value > 0);
  const successPct = Math.round((success / total) * 100);

  return (
    <ChartContainer
      config={statusChartConfig}
      className="mx-auto h-[170px] w-full max-w-[260px] aspect-square"
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name) =>
                `${value} ${String(name).toLowerCase()}`
              }
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={48}
          outerRadius={66}
          strokeWidth={3}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox))
                return null;
              return (
                <text
                  x={viewBox.cx}
                  y={viewBox.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  <tspan
                    x={viewBox.cx}
                    y={viewBox.cy}
                    className="fill-foreground text-lg font-semibold"
                  >
                    {successPct}%
                  </tspan>
                  <tspan
                    x={viewBox.cx}
                    y={(viewBox.cy ?? 0) + 18}
                    className="fill-muted-foreground text-[10px] font-mono"
                  >
                    {total} run{total !== 1 ? "s" : ""}
                  </tspan>
                </text>
              );
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
