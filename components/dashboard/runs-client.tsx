"use client";

import { useSnapshot } from "@/lib/queries";
import { formatDuration } from "@/app/lib/intelligence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunsAccordion } from "@/components/dashboard/runs-accordion";
import type { ExecutionSnapshot } from "@/lib/execution-store";

export function RunsClient({
  initialData,
  repoId,
  repoFullName,
}: {
  initialData: ExecutionSnapshot;
  repoId?: string;
  repoFullName?: string;
}) {
  const { data = initialData } = useSnapshot({
    initialData,
    initialDataUpdatedAt: Date.now(),
  });

  const allRuns = data.workflowRuns;
  const repoRuns = repoId ? allRuns.filter((r) => r.repositoryId === repoId) : allRuns;
  const sorted = [...repoRuns].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  const totalRuns = sorted.length;
  const failed = sorted.filter((r) => r.status === "failed").length;
  const enriched = sorted.filter((r) => r.telemetrySource === "execforge-wrapper").length;
  const avgDuration = totalRuns
    ? Math.round(sorted.reduce((s, r) => s + r.totalDurationSec, 0) / totalRuns)
    : 0;

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 fade-up-1">
        {[
          { label: "Total Runs", value: totalRuns.toString() },
          { label: "Failed", value: failed.toString() },
          { label: "Enriched", value: `${enriched} / ${totalRuns}` },
          { label: "Avg Duration", value: formatDuration(avgDuration) },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-4">
              <p className="text-label mb-2">{s.label}</p>
              <p className="stat-value">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border fade-up-2">
        <CardHeader className="px-4 py-3 border-b border-border">
          <CardTitle className="text-sm font-medium">All Workflow Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <RunsAccordion
            runs={sorted}
            emptyMessage={`No runs found for ${repoFullName ?? "this repository"}.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
