"use client";

import { useState } from "react";
import type { WorkflowRun, OptimizationAction, RepositoryProfile } from "@/app/lib/types";
import { formatDuration } from "@/app/lib/intelligence";
import {
  GitPullRequest, Loader2, CheckCircle2, AlertCircle,
  ExternalLink, ChevronDown, ChevronRight, Sparkles,
  BrainCircuit, AlertTriangle, RefreshCw,
} from "lucide-react";
import { MultiFileDiff } from "@pierre/diffs/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  useCreatePR, useExistingPlans, useAIScan,
  type PRResult, type AIScanIssue,
} from "@/lib/queries";
import type { ExistingPlan } from "@/lib/execution-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className={`tag text-[10px] ${risk === "low" ? "tag-success" : risk === "high" ? "tag-danger" : "tag-warning"}`}>
      {risk}
    </span>
  );
}

// ─── Action row ────────────────────────────────────────────────────────────────

function ActionRow({
  action, run, repository, highlightActionId, diffView, existingPlan,
}: {
  action: OptimizationAction;
  run: WorkflowRun;
  repository: RepositoryProfile;
  highlightActionId?: string;
  diffView: "split" | "unified";
  existingPlan?: ExistingPlan;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(action.id === highlightActionId);
  const [result, setResult] = useState<PRResult | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showDraftDiffs, setShowDraftDiffs] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { mutate: createPR, isPending, variables } = useCreatePR();

  const currentResult: PRResult | null = result || (existingPlan?.plan ? {
    mode: existingPlan.githubPullRequestUrl ? "created" : "draft",
    plan: existingPlan.plan,
    pullRequest: existingPlan.githubPullRequestNumber ? {
      number: existingPlan.githubPullRequestNumber,
      url: existingPlan.githubPullRequestUrl as string
    } : undefined
  } : null);

  const hasPR = existingPlan?.githubPullRequestUrl;
  const prUrl = currentResult?.pullRequest?.url ?? existingPlan?.githubPullRequestUrl;
  const prNumber = currentResult?.pullRequest?.number ?? existingPlan?.githubPullRequestNumber;

  function invalidatePlans() {
    void qc.invalidateQueries({ queryKey: queryKeys.existingPlans(repository.fullName, run.id) });
  }

  function submitPR(mode: "draft" | "create", userFeedback?: string) {
    createPR(
      { actionId: action.id, repositoryFullName: repository.fullName, runId: run.id, mode, userFeedback },
      {
        onSuccess: (data) => {
          setResult(data);
          setShowFeedback(false);
          setFeedback("");
          invalidatePlans();
          if (data.mode === "created" && data.pullRequest?.url) {
            window.open(data.pullRequest.url, "_blank", "noopener,noreferrer");
          }
        },
      },
    );
  }

  const isHighlighted = action.id === highlightActionId;

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: isHighlighted ? "color-mix(in srgb, #facc15 4%, transparent)" : undefined }}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "20px 1fr 110px 90px 60px 24px",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          height: "auto",
          borderRadius: 0,
          justifyContent: "start",
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
        <span style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          {action.title}
          {action.isAiGenerated && (
            <span className="tag tag-info font-mono text-[10px] px-1.5 py-0.5">AI Scan</span>
          )}
          {action.isAiGenerated && existingPlan?.plan && (
            <span className="tag tag-success font-mono text-[10px] px-1.5 py-0.5">Solution ready</span>
          )}
        </span>
        <span><span className="tag tag-success text-[10px]">{action.estimatedTimeSavingsPct}% faster</span></span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>${action.estimatedCostSavingsUsdMonthly}/mo</span>
        <span style={{ display: "flex", justifyContent: "center" }}><RiskBadge risk={action.risk} /></span>
        <span style={{ display: "flex", justifyContent: "center" }}>
          {hasPR && (
            <a href={prUrl!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              title={`PR #${prNumber} open`}
              style={{ display: "flex", alignItems: "center", color: "#4ade80" }}>
              <CheckCircle2 size={13} />
            </a>
          )}
        </span>
      </Button>

      {open && (
        <div style={{ padding: "12px 16px 16px 48px", borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 50%, transparent)" }}>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.7, marginBottom: 12 }}>{action.rationale}</p>

          {action.filesToChange.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>Files affected</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {action.filesToChange.map((f) => (
                  <code key={f} style={{ fontSize: 10, fontFamily: "var(--font-mono)", background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>{f}</code>
                ))}
              </div>
            </div>
          )}

          {hasPR && !currentResult && (
            <div className="flex items-center gap-2 mb-4 text-xs">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-[#4ade80]/10 border border-[#4ade80]/20 text-[#4ade80]">
                 <CheckCircle2 size={11} />
              </div>
              <span className="text-muted-foreground">PR #{prNumber} already open —</span>
              <a href={prUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline underline-offset-2 transition-all">
                Open on GitHub <ExternalLink size={10} />
              </a>
            </div>
          )}

          {currentResult?.error && (
            <div className="flex items-start gap-2 mb-4 text-xs">
              <div className="flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-[#f87171]/10 border border-[#f87171]/20 text-[#f87171] mt-0.5">
                 <AlertCircle size={11} />
              </div>
              <span className="text-[#f87171]/90 leading-relaxed">{currentResult.error}</span>
            </div>
          )}
          {currentResult?.mode === "created" && currentResult.pullRequest?.url && (
            <div className="flex items-center gap-2 mb-4 text-xs">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-[#4ade80]/10 border border-[#4ade80]/20 text-[#4ade80]">
                 <CheckCircle2 size={11} />
              </div>
              <span className="text-muted-foreground">PR #{currentResult.pullRequest.number} created successfully —</span>
              <a href={currentResult.pullRequest.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline underline-offset-2 transition-all">
                Open on GitHub <ExternalLink size={10} />
              </a>
            </div>
          )}

          {currentResult?.mode === "draft" && !currentResult.error && currentResult.plan && (
            <div style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-[#818cf8]/10 border border-[#818cf8]/20 text-[#818cf8]">
                   <CheckCircle2 size={11} />
                </div>
                <span className="text-muted-foreground flex-1">
                  Draft plan ready for <code className="font-mono text-[10px] bg-secondary border border-border px-1.5 py-0.5 rounded text-foreground">{currentResult.plan.branchName}</code> — click <span className="font-medium text-foreground">Create PR</span> to push to GitHub.
                </span>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowDraftDiffs(prev => !prev)}
                  className="h-6 px-2 text-[10px] gap-1"
                >
                  {showDraftDiffs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {showDraftDiffs ? "Hide preview" : "Show preview"}
                </Button>
                {action.isAiGenerated && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-[#818cf8] bg-[#818cf8]/10 px-1.5 py-0.5 rounded-sm border border-[#818cf8]/20">
                    <Sparkles size={10} /> AI Generated
                  </span>
                )}
              </div>
              {showDraftDiffs && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {currentResult.plan.files?.map((file) => (
                    <div key={file.path} style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ padding: "6px 12px", background: "var(--secondary)", borderBottom: "1px solid var(--border)", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)", display: "flex", justifyContent: "space-between" }}>
                        <span>{file.path}</span>
                        <span className="tag tag-muted text-[9px]">{file.operation}</span>
                      </div>
                      <div style={{ fontSize: 11, background: "var(--card)" }}>
                        <MultiFileDiff key={diffView} disableWorkerPool={true} options={{ diffStyle: diffView, overflow: "scroll" }}
                          oldFile={{ name: file.path, contents: file.oldContent ?? "" }}
                          newFile={{ name: file.path, contents: file.content }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasPR && (
            <div className="flex flex-col gap-4 mt-6 pt-4 border-t border-border">
              {showFeedback && (
                <div className="p-4 bg-muted/30 rounded-lg border border-border">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-background border border-border shrink-0 mt-0.5">
                      <Sparkles size={12} className="text-[#818cf8]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground mb-1">Adjust AI Solution</p>
                      <p className="text-[12px] text-muted-foreground mb-3 leading-relaxed">Describe what you'd like to change and the AI will generate a new draft plan.</p>
                      <textarea 
                        className="w-full text-[13px] bg-background border border-border rounded-md p-2.5 min-h-[80px] focus:outline-none focus:ring-1 focus:ring-[#818cf8]"
                        placeholder="e.g. Use a different testing framework, don't change this specific line, etc."
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                      />
                      <div className="flex items-center justify-end gap-2 mt-3">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowFeedback(false)} className="rounded-md text-[12px] h-8">Cancel</Button>
                        <Button 
                          type="button" 
                          size="sm" 
                          onClick={() => submitPR("draft", feedback)}
                          disabled={isPending || !feedback.trim()}
                          className="gap-1.5 rounded-md bg-[#818cf8] text-white hover:bg-[#818cf8]/90 text-[12px] h-8"
                        >
                          {isPending && variables?.mode === "draft" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          Regenerate with AI
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                {action.isAiGenerated && currentResult?.mode === "draft" && !showFeedback && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowFeedback(true)} className="mr-auto gap-1.5 rounded-md text-muted-foreground hover:text-foreground">
                    <RefreshCw size={12} /> Regenerate solution
                  </Button>
                )}
                
                <div className={`flex items-center gap-2 ${action.isAiGenerated && currentResult?.mode === "draft" && !showFeedback ? "" : "ml-auto"}`}>
                  {!currentResult?.plan && (
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => submitPR("draft")}
                      size="sm"
                      variant="outline"
                      className="gap-1.5 rounded-md"
                    >
                      {isPending && variables?.mode === "draft" && <Loader2 size={12} className="animate-spin" />}
                      {isPending && variables?.mode === "draft" ? "Previewing…" : "Preview draft"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={isPending}
                    onClick={() => submitPR("create")}
                    size="sm"
                    className="gap-1.5 rounded-md bg-foreground text-background hover:opacity-90"
                  >
                    {isPending && variables?.mode === "create" ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
                    {isPending && variables?.mode === "create" ? "Creating…" : "Create PR on GitHub"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



// ─── Public component ──────────────────────────────────────────────────────────

export function PrAgentClient({
  run, allRuns, repository, actions, simulation, highlightActionId,
}: {
  run: WorkflowRun;
  allRuns: WorkflowRun[];
  repository: RepositoryProfile;
  actions: OptimizationAction[];
  simulation: { projectedSec: number; timeSavedSec: number };
  highlightActionId?: string;
}) {
  const [diffView, setDiffView] = useState<"split" | "unified">("split");

  const { data: existingPlans = [] } = useExistingPlans(repository.fullName, run.id);

  const aiActions: OptimizationAction[] = Array.isArray(run.aiScanResult)
    ? run.aiScanResult.map((issue: any) => ({
        id: issue.action.id,
        title: issue.action.title,
        rationale: issue.action.rationale,
        estimatedTimeSavingsPct: issue.action.estimatedTimeSavingsPct,
        estimatedCostSavingsUsdMonthly: issue.action.estimatedCostSavingsUsdMonthly,
        risk: issue.action.risk,
        filesToChange: issue.action.filesToChange,
        isAiGenerated: true,
      }))
    : [];

  const existingIds = new Set(actions.map((a) => a.id));
  const uniqueAiActions = aiActions.filter((a) => !existingIds.has(a.id));
  const allActions = [...actions, ...uniqueAiActions];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
      {/* Simulation summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          { label: "Current Duration", value: formatDuration(run.totalDurationSec) },
          { label: "Projected Duration", value: formatDuration(simulation.projectedSec) },
          { label: "Time Saved", value: formatDuration(simulation.timeSavedSec) },
        ].map((s) => (
          <div key={s.label} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16, background: "var(--card)" }}>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)", marginBottom: 6 }}>{s.label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Analyzed run */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600 }}>Analyzed Run</p>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>
            {repository.fullName} · {run.workflowName} · {run.branch}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0 }}>
          {[
            { k: "Jobs", v: run.jobs.length },
            { k: "Tests", v: run.tests.length },
            { k: "Commit", v: run.commitSha.slice(0, 7) },
            { k: "Total runs analyzed", v: allRuns.length },
          ].map(({ k, v }) => (
            <div key={k} style={{ padding: "12px 16px", borderRight: "1px solid var(--border)" }}>
              <p style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4 }}>{k}</p>
              <p style={{ fontSize: 14, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Optimization queue */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600 }}>Optimization Queue</p>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {allActions.length} action{allActions.length !== 1 ? "s" : ""} · click to expand
            </span>
            {aiActions.length > 0 && (
              <span style={{ fontSize: 10, color: "#818cf8", display: "flex", alignItems: "center", gap: 4 }}>
                <Sparkles size={10} /> {aiActions.length} from AI scan
              </span>
            )}
          </div>
          <Tabs value={diffView} onValueChange={(v) => setDiffView(v as "split" | "unified")}>
            <TabsList className="h-7 rounded-md p-0.5">
              <TabsTrigger value="split" className="h-6 rounded px-2.5 py-0 text-[11px]">Split</TabsTrigger>
              <TabsTrigger value="unified" className="h-6 rounded px-2.5 py-0 text-[11px]">Unified</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px 90px 60px 24px", gap: 12, padding: "6px 16px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
          {["", "Action", "Time Saving", "Cost Saving", "Risk", "PR"].map((h) => (
            <span key={h} style={{ 
              fontSize: 10, 
              fontWeight: 600, 
              textTransform: "uppercase", 
              letterSpacing: "0.05em", 
              color: "var(--muted-foreground)",
              textAlign: (h === "Risk" || h === "PR") ? "center" : "left"
            }}>{h}</span>
          ))}
        </div>

        {allActions.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
            No optimization actions suggested for this run.
          </div>
        ) : (
          allActions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              run={run}
              repository={repository}
              highlightActionId={highlightActionId}
              diffView={diffView}
              existingPlan={existingPlans.find((p) => p.actionId === action.id)}
            />
          ))
        )}
      </div>

    </div>
  );
}
