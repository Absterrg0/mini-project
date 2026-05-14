"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkflowRun, OptimizationAction, RepositoryProfile } from "@/app/lib/types";
import { formatDuration } from "@/app/lib/intelligence";
import {
  GitPullRequest, Loader2, CheckCircle2, AlertCircle,
  ExternalLink, ChevronDown, ChevronRight, Sparkles,
  BrainCircuit, AlertTriangle, RefreshCw, FileDiff,
} from "lucide-react";
import { MultiFileDiff } from "@pierre/diffs/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCreatePR, useExistingPlans, useValidateAIIssue,
  type PRResult,
} from "@/lib/queries";
import type { ExistingPlan } from "@/lib/execution-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { isAiScanStaleForRun } from "@/lib/ai-scan-stale";
import { XCircle, ShieldCheck } from "lucide-react";

/** Normalize plan file text for equality checks (line endings + trim). */
function normalizePlanFileTextForCompare(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

type PlanFileForDiff = {
  path: string;
  content: string;
  operation: string;
  oldContent?: string;
};

/** Omit files that produce an empty (+0/-0) diff from the draft viewer. */
function shouldShowPlanFileInDraftDiff(file: PlanFileForDiff): boolean {
  const newNorm = normalizePlanFileTextForCompare(file.content);
  const oldNorm = normalizePlanFileTextForCompare(file.oldContent);

  if (file.operation === "create") {
    return newNorm !== "";
  }

  if (newNorm === oldNorm) {
    return false;
  }

  return true;
}

function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className={`tag text-[10px] ${risk === "low" ? "tag-success" : risk === "high" ? "tag-danger" : "tag-warning"}`}>
      {risk}
    </span>
  );
}

function formatPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.max(0, Math.round(number))}% faster` : "0% faster";
}

function formatMonthlySavings(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${Math.max(0, Math.round(number))}/mo` : "$0/mo";
}

function positiveOrFallback(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(number, fallback) : fallback;
}

// ─── Action row ────────────────────────────────────────────────────────────────

function ActionRow({
  action, run, repository, highlightActionId, diffView, existingPlan, plansCarryForwardSourceRunId, showAiOutdated, onDismiss,
}: {
  action: OptimizationAction;
  run: WorkflowRun;
  repository: RepositoryProfile;
  highlightActionId?: string;
  diffView: "split" | "unified";
  existingPlan?: ExistingPlan;
  /** Matches `useExistingPlans` query key so invalidation refetches merged plans. */
  plansCarryForwardSourceRunId?: string | null;
  /** AI-derived row whose persisted scan predates the current snapshot commit. */
  showAiOutdated?: boolean;
  /** Called when the issue is validated as resolved and the row should be removed. */
  onDismiss?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(action.id === highlightActionId);
  const [result, setResult] = useState<PRResult | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showDraftDiffs, setShowDraftDiffs] = useState(() =>
    Boolean(existingPlan?.plan && !existingPlan.githubPullRequestUrl),
  );
  const [feedback, setFeedback] = useState("");
  /** Paths whose draft diff body is collapsed (header stays visible). */
  const [collapsedDraftFilePaths, setCollapsedDraftFilePaths] = useState<Set<string>>(() => new Set());
  const { mutate: createPR, isPending, variables } = useCreatePR();

  // ── Validation state for outdated AI issues ──────────────────────────────
  type ValidationState = "idle" | "validating" | "valid" | "invalid";
  const [validationState, setValidationState] = useState<ValidationState>("idle");
  const [validationReason, setValidationReason] = useState<string>("");
  const { mutate: validateIssue, isPending: isValidating } = useValidateAIIssue();

  const currentResult: PRResult | null = result || (existingPlan?.plan ? {
    mode: existingPlan.githubPullRequestUrl ? "created" : "draft",
    plan: existingPlan.plan,
    pullRequest: existingPlan.githubPullRequestNumber ? {
      number: existingPlan.githubPullRequestNumber,
      url: existingPlan.githubPullRequestUrl as string
    } : undefined
  } : null);

  const prUrl = currentResult?.pullRequest?.url ?? existingPlan?.githubPullRequestUrl;
  const prNumber = currentResult?.pullRequest?.number ?? existingPlan?.githubPullRequestNumber;
  const hasPR = Boolean(prUrl);
  const prStatus = existingPlan?.githubPullRequestStatus ?? (currentResult?.pullRequest?.url ? "raised" : null);
  const prColor = prStatus === "merged" ? "#a78bfa" : "#facc15";
  const prTooltipText = prStatus === "merged" ? "PR merged" : "PR raised";

  function invalidatePlans() {
    void qc.invalidateQueries({
      queryKey: queryKeys.existingPlans(repository.fullName, run.id, plansCarryForwardSourceRunId),
    });
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
          if (data.mode === "draft" && data.plan && !data.error) {
            setShowDraftDiffs(true);
          }
          if (data.mode === "created" && data.pullRequest?.url) {
            window.open(data.pullRequest.url, "_blank", "noopener,noreferrer");
          }
        },
      },
    );
  }

  /** Triggered when user clicks ✨ on an outdated AI issue — validates first, then generates or dismisses. */
  function handleGenerateWithValidation() {
    setOpen(true);
    setValidationState("validating");
    validateIssue(
      { repositoryFullName: repository.fullName, runId: run.id, issueId: action.id },
      {
        onSuccess: (data) => {
          if (data.valid) {
            setValidationState("valid");
            // Proceed straight to draft generation
            submitPR("draft");
          } else {
            setValidationState("invalid");
            setValidationReason(data.reason);
          }
        },
        onError: () => {
          // On error, fall back to treating as valid so the user isn't blocked
          setValidationState("valid");
          submitPR("draft");
        },
      },
    );
  }

  const isHighlighted = action.id === highlightActionId;

  /** One control in the leading actions slot: never show Generate and Regenerate together for AI drafts. */
  const aiDraftRegenerate =
    Boolean(action.isAiGenerated && currentResult?.mode === "draft");
  const showGenerateSolution = !currentResult?.plan && !aiDraftRegenerate;

  const draftPlanFiles = currentResult?.plan?.files ?? [];
  const draftVisiblePlanFiles = draftPlanFiles.filter(shouldShowPlanFileInDraftDiff);

  const draftPlanKey =
    currentResult?.mode === "draft" &&
    currentResult.plan &&
    !currentResult.error
      ? `${currentResult.plan.branchName}:${draftPlanFiles
          .map((f) => f.path)
          .sort()
          .join("|")}`
      : null;
  const lastAutoRevealPlanKey = useRef<string | null>(null);

  useEffect(() => {
    if (!draftPlanKey) {
      lastAutoRevealPlanKey.current = null;
      setCollapsedDraftFilePaths(new Set());
      return;
    }
    if (lastAutoRevealPlanKey.current === draftPlanKey) return;
    lastAutoRevealPlanKey.current = draftPlanKey;
    setCollapsedDraftFilePaths(new Set());
    setShowDraftDiffs(true);
  }, [draftPlanKey]);

  function toggleActionRow() {
    const isDraftWithPlan =
      currentResult?.mode === "draft" &&
      Boolean(currentResult.plan) &&
      !currentResult.error;

    if (isDraftWithPlan) {
      if (open) {
        setOpen(false);
        setShowDraftDiffs(false);
        setCollapsedDraftFilePaths(new Set());
      } else {
        setOpen(true);
        setShowDraftDiffs(true);
        setCollapsedDraftFilePaths(new Set());
      }
      return;
    }

    setOpen((o) => !o);
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: isHighlighted ? "color-mix(in srgb, #facc15 4%, transparent)" : undefined }}>
      {/* div+role="button": row must not be <button> because action cells contain real <Button>s (invalid nested buttons). */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleActionRow}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleActionRow();
          }
        }}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "w-full rounded-none text-left outline-none",
        )}
        style={{
          display: "grid",
          gridTemplateColumns: "20px 1fr 110px 90px 60px 128px",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          height: "auto",
          justifyContent: "start",
        }}
      >
        {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
        <span className="flex min-w-0 items-center gap-2" style={{ fontSize: 13, fontWeight: 500 }}>
          <span className="min-w-0 flex-1 truncate">{action.title}</span>
          {action.isAiGenerated && (
            <span className="tag tag-info font-mono text-[10px] px-1.5 py-0.5 shrink-0">AI Scan</span>
          )}
          {showAiOutdated && (
            <span className="tag tag-warning font-mono text-[10px] px-1.5 py-0.5 shrink-0">Outdated</span>
          )}
          {action.isAiGenerated && existingPlan?.plan && (
            <span className="tag tag-success font-mono text-[10px] px-1.5 py-0.5 shrink-0">Solution ready</span>
          )}
        </span>
        <span><span className="tag tag-success text-[10px]">{formatPercent(action.estimatedTimeSavingsPct)}</span></span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>{formatMonthlySavings(action.estimatedCostSavingsUsdMonthly)}</span>
        <span style={{ display: "flex", justifyContent: "center" }}><RiskBadge risk={action.risk} /></span>
        <span
          style={{ display: "flex", justifyContent: "flex-end" }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {hasPR ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={prUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex shrink-0 text-foreground opacity-90 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                    aria-label={prNumber != null ? `Open pull request #${prNumber}` : "Open pull request"}
                  >
                    <CheckCircle2 size={15} className="shrink-0" style={{ color: prColor }} aria-hidden />
                  </a>
                }
              />
              <TooltipContent side="top" className="text-xs">
                {prTooltipText}
                {prNumber != null ? ` · #${prNumber}` : ""}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div
              className="flex flex-wrap items-center justify-end gap-0.5"
              role="group"
              aria-label="Pull request actions"
            >
              {showGenerateSolution && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        disabled={isPending || isValidating}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showAiOutdated) {
                            handleGenerateWithValidation();
                          } else {
                            setOpen(true);
                            submitPR("draft");
                          }
                        }}
                        size="icon-sm"
                        variant="outline"
                        className="shrink-0 border-border/80 bg-background/80 shadow-none hover:bg-muted/80"
                        aria-label={
                          isValidating
                            ? "Validating issue…"
                            : isPending && variables?.mode === "draft"
                            ? "Generating solution…"
                            : "Generate solution"
                        }
                      >
                        {isValidating ? (
                          <Loader2 className="size-3.5 animate-spin text-amber-400" aria-hidden />
                        ) : isPending && variables?.mode === "draft" ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : action.isAiGenerated === true ? (
                          <Sparkles className="size-3.5 text-[#818cf8]" aria-hidden />
                        ) : (
                          <FileDiff className="size-3.5 text-muted-foreground" aria-hidden />
                        )}
                      </Button>
                    }
                  />
                  <TooltipContent side="top" className="text-xs">
                    {isValidating
                      ? "Validating against current commit…"
                      : isPending && variables?.mode === "draft"
                      ? "Generating solution…"
                      : showAiOutdated
                      ? "Validate & generate solution"
                      : "Generate solution"}
                  </TooltipContent>
                </Tooltip>
              )}
              {aiDraftRegenerate && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(true);
                          setShowFeedback(true);
                        }}
                        className="shrink-0 border-border/80 bg-background/80 shadow-none hover:bg-muted/80"
                        aria-label="Regenerate PR plan"
                      >
                        <RefreshCw className="size-3.5 text-muted-foreground" aria-hidden />
                      </Button>
                    }
                  />
                  <TooltipContent side="top" className="text-xs">
                    Regenerate
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(true);
                        submitPR("create");
                      }}
                      size="icon-sm"
                      variant="default"
                      className="shrink-0 bg-foreground text-background hover:opacity-90"
                      aria-label={
                        isPending && variables?.mode === "create" ? "Creating pull request" : "Create pull request"
                      }
                    >
                      {isPending && variables?.mode === "create" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <GitPullRequest className="size-3.5" aria-hidden />
                      )}
                    </Button>
                  }
                />
                <TooltipContent side="top" className="text-xs">
                  {isPending && variables?.mode === "create" ? "Creating…" : "Create PR"}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </span>
      </div>

      {/* Dismissal banner — shown when validation found the issue is no longer relevant */}
      {validationState === "invalid" && (
        <div className="border-t border-amber-500/20 bg-amber-500/8 px-6 py-3 pl-10">
          <div className="flex flex-row items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="flex shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/15 p-1.5 text-amber-400 mt-0.5">
                <ShieldCheck size={13} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-amber-300 leading-snug mb-0.5">
                  Issue resolved in current commit
                </p>
                <p className="text-[12px] text-amber-400/80 leading-relaxed break-words">
                  {validationReason || "This issue no longer appears to be present in the latest workflow run."}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-amber-400/70 hover:bg-amber-500/15 hover:text-amber-300"
              onClick={() => onDismiss?.()}
              aria-label="Dismiss resolved issue"
            >
              <XCircle size={14} />
            </Button>
          </div>
        </div>
      )}

      {open && validationState !== "invalid" && (
        <div className="flex flex-col gap-6 border-t border-border/50 px-6 py-4 pl-10">

          {/* Summary (+ actions when no PR yet) */}
          {hasPR ? (
            <section className="max-w-[90ch] border-b border-border/40 pb-5">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{action.rationale}</p>
            </section>
          ) : (
            <section className="min-w-0 max-w-[min(100%,90ch)] border-b border-border/40 pb-5">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{action.rationale}</p>
              {currentResult?.mode === "draft" &&
                !currentResult.error &&
                currentResult.plan &&
                !showDraftDiffs &&
                ((draftVisiblePlanFiles.length > 0 || draftPlanFiles.length > 0) || action.isAiGenerated) && (
                <div className="mt-4 space-y-3 border-t border-border/30 pt-4">
                  {draftVisiblePlanFiles.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
                        Files affected
                      </p>
                      <div className="flex flex-wrap gap-1.5" dir="ltr">
                        {draftVisiblePlanFiles.map((file) => (
                          <code
                            key={file.path}
                            className="rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground/90"
                          >
                            {file.path}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  {action.isAiGenerated && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#818cf8]/12 px-1.5 py-0.5 text-[10px] font-medium text-[#818cf8]">
                        <Sparkles size={10} /> AI Generated
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* PR already open */}
          {hasPR && !currentResult && (
            <div className="rounded-md border border-[#4ade80]/30 bg-[#4ade80]/10 py-2.5 px-3">
              <div className="flex flex-row items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex shrink-0 items-center justify-center rounded-md border border-[#4ade80]/25 bg-[#4ade80]/15 p-1.5 text-[#4ade80]">
                    <CheckCircle2 size={14} strokeWidth={2} />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground leading-snug">
                    PR #{prNumber} already open
                  </p>
                </div>
                <a
                  href={prUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#4ade80]/35 bg-background/70 px-2.5 py-1.5 text-[13px] font-medium text-[#4ade80] hover:bg-[#4ade80]/15 hover:text-[#86efac] transition-colors"
                >
                  View PR
                  <ExternalLink size={14} className="shrink-0 opacity-90" aria-hidden />
                </a>
              </div>
            </div>
          )}

          {/* Error */}
          {currentResult?.error && (
            <div className="rounded-md border border-[#f87171]/35 bg-[#f87171]/10 py-2.5 px-3">
              <div className="flex flex-row items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex shrink-0 items-center justify-center rounded-md border border-[#f87171]/30 bg-[#f87171]/15 p-1.5 text-[#f87171]">
                    <AlertCircle size={14} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-[13px] font-medium text-[#fca5a5] leading-snug">Something went wrong</p>
                    <p className="break-words text-[13px] text-[#f87171] leading-relaxed">{currentResult.error}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-[12px]"
                  onClick={() => setResult(null)}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}

          {/* Draft diff viewer */}
          {currentResult?.mode === "draft" && !currentResult.error && currentResult.plan && showDraftDiffs && (
            <section aria-label="Draft diff" className="min-w-0">
              <div className="flex flex-col gap-4">
                {draftVisiblePlanFiles.length === 0 ? (
                  <p className="py-1 text-center text-[12px] text-muted-foreground">
                    No file changes to preview — all listed files match their previous versions.
                  </p>
                ) : (
                  draftVisiblePlanFiles.map((file) => {
                    const fileCollapsed = collapsedDraftFilePaths.has(file.path);
                    return (
                      <div
                        key={file.path}
                        className="overflow-hidden rounded-lg bg-muted/15 ring-1 ring-border/45"
                      >
                        {/* div+role="button": diff viewer may render real <button>s inside — avoid invalid nested buttons. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setCollapsedDraftFilePaths((prev) => {
                              const next = new Set(prev);
                              if (next.has(file.path)) next.delete(file.path);
                              else next.add(file.path);
                              return next;
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setCollapsedDraftFilePaths((prev) => {
                                const next = new Set(prev);
                                if (next.has(file.path)) next.delete(file.path);
                                else next.add(file.path);
                                return next;
                              });
                            }
                          }}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left font-mono text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          aria-expanded={!fileCollapsed}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            {fileCollapsed ? (
                              <ChevronRight size={14} className="shrink-0 opacity-80" aria-hidden />
                            ) : (
                              <ChevronDown size={14} className="shrink-0 opacity-80" aria-hidden />
                            )}
                            <span className="min-w-0 truncate">{file.path}</span>
                          </span>
                          <span className="tag tag-muted shrink-0 text-[9px]">{file.operation}</span>
                        </div>
                        {!fileCollapsed && (
                          <div className="border-t border-border/35 bg-background/40 text-[11px]">
                            <MultiFileDiff
                              key={`${file.path}:${diffView}`}
                              disableWorkerPool={true}
                              options={{ diffStyle: diffView, overflow: "scroll" }}
                              oldFile={{ name: file.path, contents: file.oldContent ?? "" }}
                              newFile={{ name: file.path, contents: file.content }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Adjust AI Solution dialog */}
          <Dialog open={showFeedback} onOpenChange={setShowFeedback}>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[#818cf8]" />
                  Adjust AI Solution
                </DialogTitle>
                <DialogDescription>
                  {"Describe what you'd like to change and the AI will generate a new draft plan."}
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                <textarea
                  className="w-full text-[13px] bg-background border border-border rounded-md p-3 min-h-[100px] focus:outline-none focus:ring-1 focus:ring-[#818cf8] resize-none"
                  placeholder="e.g. Use a different testing framework, don't change this specific line, etc."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowFeedback(false)} className="rounded-md text-[12px] h-8">
                  Cancel
                </Button>
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
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      )}
    </div>
  );
}



// ─── Public component ──────────────────────────────────────────────────────────

type AiScanIssueRow = {
  action: {
    id: string;
    title: string;
    rationale: string;
    estimatedTimeSavingsPct?: unknown;
    estimatedCostSavingsUsdMonthly?: unknown;
    risk: OptimizationAction["risk"];
    filesToChange: string[];
  };
};

export function PrAgentClient({
  run,
  allRuns,
  repository,
  actions,
  simulation,
  highlightActionId,
  initialExistingPlans,
}: {
  run: WorkflowRun;
  allRuns: WorkflowRun[];
  repository: RepositoryProfile;
  actions: OptimizationAction[];
  simulation: { projectedSec: number; timeSavedSec: number };
  highlightActionId?: string;
  /** Server-prefetched plans so PR / “Solution ready” UI matches first paint; client still refetches when invalidated. */
  initialExistingPlans: ExistingPlan[];
}) {
  const [diffView, setDiffView] = useState<"split" | "unified">("split");
  /** Track optimistically dismissed issue IDs (validated as resolved). */
  const [dismissedActionIds, setDismissedActionIds] = useState<Set<string>>(() => new Set());

  const { data: existingPlans = [] } = useExistingPlans(repository.fullName, run.id, {
    initialData: initialExistingPlans,
    initialDataUpdatedAt: Date.now(),
  });

  const aiScanStale = isAiScanStaleForRun(run);

  /** Only issues persisted for this run (`AiScanResult` keyed by `run.id` / commit context). */
  const groundedAiIssues = Array.isArray(run.aiScanResult) ? run.aiScanResult : [];

  const aiActions: OptimizationAction[] = (groundedAiIssues as AiScanIssueRow[]).map((issue) => ({
        id: issue.action.id,
        title: issue.action.title,
        rationale: issue.action.rationale,
        estimatedTimeSavingsPct: Number(issue.action.estimatedTimeSavingsPct) || 0,
        estimatedCostSavingsUsdMonthly: Number(issue.action.estimatedCostSavingsUsdMonthly) || 0,
        risk: issue.action.risk,
        filesToChange: issue.action.filesToChange,
        isAiGenerated: true,
      }));

  const existingIds = new Set(actions.map((a) => a.id));
  const uniqueAiActions = aiActions.filter((a) => !existingIds.has(a.id));
  const allActions = [...actions, ...uniqueAiActions];

  const mergedPlanActionIds = new Set(
    existingPlans.filter((p) => p.githubPullRequestStatus === "merged").map((p) => p.actionId),
  );
  const queueActions = allActions.filter(
    (a) => !mergedPlanActionIds.has(a.id) && !dismissedActionIds.has(a.id),
  );

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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 600 }}>Optimization Queue</p>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {queueActions.length} action{queueActions.length !== 1 ? "s" : ""} · click to expand
              </span>
              {aiActions.length > 0 && (
                <span style={{ fontSize: 10, color: "#818cf8", display: "flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={10} /> {aiActions.length} from AI scan
                </span>
              )}
              {aiScanStale && (
                <span style={{ fontSize: 10, color: "var(--muted-foreground)", maxWidth: 420 }}>
                  Commit changed since last scan — use AI Deep Scan to refresh.
                </span>
              )}
            </div>
          </div>
          <Tabs value={diffView} onValueChange={(v) => setDiffView(v as "split" | "unified")}>
            <TabsList className="h-7 rounded-md p-0.5">
              <TabsTrigger value="split" className="h-6 rounded px-2.5 py-0 text-[11px]">Split</TabsTrigger>
              <TabsTrigger value="unified" className="h-6 rounded px-2.5 py-0 text-[11px]">Unified</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px 90px 60px 128px", gap: 12, padding: "6px 16px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
          {[
            { key: "chev", label: "", align: "left" as const },
            { key: "action", label: "Action", align: "left" as const },
            { key: "time", label: "Time Saving", align: "left" as const },
            { key: "cost", label: "Cost Saving", align: "left" as const },
            { key: "risk", label: "Risk", align: "center" as const },
            { key: "acts", label: "Actions", align: "right" as const },
          ].map((h) => (
            <span
              key={h.key}
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
                textAlign: h.align,
              }}
            >
              {h.label}
            </span>
          ))}
        </div>

        {queueActions.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
            {allActions.length === 0
              ? "No optimization actions suggested for this run."
              : "No pending optimizations — linked pull requests are merged."}
          </div>
        ) : (
          queueActions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              run={run}
              repository={repository}
              highlightActionId={highlightActionId}
              diffView={diffView}
              existingPlan={existingPlans.find((p) => p.actionId === action.id)}
              showAiOutdated={Boolean(action.isAiGenerated && aiScanStale)}
              onDismiss={() =>
                setDismissedActionIds((prev) => new Set([...prev, action.id]))
              }
            />
          ))
        )}
      </div>

    </div>
  );
}
