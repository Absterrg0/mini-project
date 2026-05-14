"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FlaskConical, Sparkles, ExternalLink, GitPullRequest,
  Zap, AlertTriangle, Clock, Globe, TestTube2, Check, Copy, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerateTestsPR, type TestScaffoldFlavor, type GenerateTestsPRResult } from "@/lib/queries";

// ─── Test flavor definitions ──────────────────────────────────────────────────

const TEST_FLAVORS: Array<{
  id: TestScaffoldFlavor;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
  bg: string;
  border: string;
  tag: string;
}> = [
  {
    id: "flaky",
    label: "Flaky Tests",
    description: "Intermittently failing tests that reveal timing issues and race conditions",
    icon: <Zap size={15} strokeWidth={2} />,
    accent: "text-yellow-400",
    bg: "bg-yellow-400/8",
    border: "border-yellow-400/25",
    tag: "Most realistic",
  },
  {
    id: "failing",
    label: "Failing Tests",
    description: "Deterministically broken assertions that surface CI red paths",
    icon: <AlertTriangle size={15} strokeWidth={2} />,
    accent: "text-red-400",
    bg: "bg-red-400/8",
    border: "border-red-400/25",
    tag: "High impact",
  },
  {
    id: "slow",
    label: "Slow Tests",
    description: "Duration-heavy tests that expose CI bottlenecks and timeouts",
    icon: <Clock size={15} strokeWidth={2} />,
    accent: "text-orange-400",
    bg: "bg-orange-400/8",
    border: "border-orange-400/25",
    tag: "Performance",
  },
  {
    id: "e2e",
    label: "E2E Tests",
    description: "Integration tests covering user flows, API endpoints, and UI navigation",
    icon: <Globe size={15} strokeWidth={2} />,
    accent: "text-blue-400",
    bg: "bg-blue-400/8",
    border: "border-blue-400/25",
    tag: "Playwright-style",
  },
  {
    id: "unit",
    label: "Unit Tests",
    description: "Isolated unit specs with deep mocking, edge cases, and boundary conditions",
    icon: <TestTube2 size={15} strokeWidth={2} />,
    accent: "text-emerald-400",
    bg: "bg-emerald-400/8",
    border: "border-emerald-400/25",
    tag: "Best coverage",
  },
];

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onDismiss,
}: {
  result: GenerateTestsPRResult;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function copyFile(content: string, path: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="w-full max-w-2xl mt-6 rounded-xl border border-border bg-card/80 overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            {result.prUrl ? <GitPullRequest size={14} /> : <FlaskConical size={14} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {result.prUrl ? "Pull Request created" : "Test files generated"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {result.prUrl
                ? `Branch: ${result.branchName}`
                : "GitHub App not installed — copy the files below"}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {/* PR link */}
      {result.prUrl && (
        <a
          href={result.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-5 py-3 bg-emerald-500/6 border-b border-emerald-500/15 hover:bg-emerald-500/10 transition-colors group"
        >
          <ExternalLink size={13} className="text-emerald-400 shrink-0" />
          <span className="text-sm text-emerald-300 font-medium truncate">{result.prUrl}</span>
          <span className="ml-auto text-xs text-emerald-500/70 group-hover:text-emerald-400 transition-colors shrink-0">
            Open →
          </span>
        </a>
      )}

      {/* Files */}
      <div className="divide-y divide-border/50">
        {result.files.map((file) => (
          <div key={file.path} className="px-5 py-3.5">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[12px] font-mono text-foreground/90 truncate">{file.path}</span>
              <button
                onClick={() => copyFile(file.content, file.path)}
                className="shrink-0 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-2 py-0.5 hover:bg-muted"
              >
                {copied === file.path ? (
                  <><Check size={11} className="text-emerald-400" /> Copied</>
                ) : (
                  <><Copy size={11} /> Copy</>
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">{file.summary}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-muted/10 border-t border-border/50 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Merge this PR, push a commit to trigger CI, then return here to see test signals.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="shrink-0 text-xs text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ─── Main empty state component ───────────────────────────────────────────────

export function TestsEmptyState({
  repositoryFullName,
}: {
  repositoryFullName?: string;
}) {
  const [selected, setSelected] = useState<TestScaffoldFlavor>("flaky");
  const [result, setResult] = useState<GenerateTestsPRResult | null>(null);
  const { mutate, isPending } = useGenerateTestsPR();

  function handleGenerate() {
    if (!repositoryFullName) {
      toast.error("No repository selected", {
        description: "Connect a repository first via Settings.",
      });
      return;
    }

    mutate(
      { repositoryFullName, flavor: selected },
      {
        onSuccess: (data) => {
          setResult(data);
          if (data.prUrl) {
            toast.success("Pull Request opened!", {
              description: "Your sample tests are ready on GitHub.",
              action: {
                label: "View PR",
                onClick: () => window.open(data.prUrl!, "_blank", "noopener,noreferrer"),
              },
            });
          } else {
            toast.success("Test files generated", {
              description: "Copy the files below and commit them to your repo.",
            });
          }
        },
      },
    );
  }

  const selectedFlavor = TEST_FLAVORS.find((f) => f.id === selected)!;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-12 text-center">
      {/* Icon */}
      <div className="relative mb-6">
        <div className="size-14 rounded-2xl border border-border bg-card flex items-center justify-center shadow-sm">
          <FlaskConical size={22} strokeWidth={1.5} className="text-muted-foreground" />
        </div>
        <div
          className="absolute -bottom-1 -right-1 size-5 rounded-full border border-border bg-card flex items-center justify-center"
          aria-hidden
        >
          <Sparkles size={10} className="text-[#818cf8]" />
        </div>
      </div>

      {/* Headline */}
      <div className="mb-8 max-w-md">
        <h2 className="text-base font-semibold text-foreground mb-2">No test signals yet</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          ExecForge hasn&apos;t seen any test results from your CI runs yet.
          Generate sample tests to explore flakiness detection, failure analysis, and duration insights.
        </p>
      </div>

      {/* Flavor selector */}
      <div className="w-full max-w-2xl mb-5">
        <p className="text-xs font-medium text-muted-foreground mb-3 text-left">
          Choose test type to generate
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {TEST_FLAVORS.map((flavor) => {
            const isSelected = selected === flavor.id;
            return (
              <button
                key={flavor.id}
                onClick={() => setSelected(flavor.id)}
                className={`
                  relative flex flex-col items-start gap-2 rounded-lg border px-4 py-3.5 text-left transition-all duration-150
                  ${isSelected
                    ? `${flavor.bg} ${flavor.border} shadow-sm`
                    : "border-border/60 bg-card/50 hover:bg-card hover:border-border"
                  }
                `}
                aria-pressed={isSelected}
              >
                {/* Selected indicator */}
                {isSelected && (
                  <div className={`absolute top-2.5 right-2.5 size-4 rounded-full flex items-center justify-center ${flavor.bg} ${flavor.border} border`}>
                    <Check size={9} className={flavor.accent} strokeWidth={2.5} />
                  </div>
                )}

                {/* Icon + tag */}
                <div className="flex items-center gap-2 w-full pr-5">
                  <span className={isSelected ? flavor.accent : "text-muted-foreground"}>
                    {flavor.icon}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isSelected ? `${flavor.bg} ${flavor.accent}` : "bg-muted text-muted-foreground"}`}>
                    {flavor.tag}
                  </span>
                </div>

                {/* Label + description */}
                <div>
                  <p className={`text-[13px] font-semibold leading-tight ${isSelected ? "text-foreground" : "text-foreground/80"}`}>
                    {flavor.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {flavor.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 w-full max-w-2xl">
        <Button
          onClick={handleGenerate}
          disabled={isPending || !repositoryFullName}
          className="h-9 px-5 gap-2 text-sm font-medium"
        >
          {isPending ? (
            <>
              <svg
                className="size-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              Generating {selectedFlavor.label}…
            </>
          ) : (
            <>
              <Sparkles size={13} />
              Add {selectedFlavor.label} to my repo
            </>
          )}
        </Button>

        {!repositoryFullName && (
          <p className="text-[11px] text-muted-foreground">
            No repository selected.{" "}
            <Link href="/dashboard/settings" className="underline underline-offset-2 hover:text-foreground transition-colors">
              Connect one in Settings
            </Link>
          </p>
        )}

        {repositoryFullName && (
          <p className="text-[11px] text-muted-foreground">
            Will open a PR on{" "}
            <span className="font-mono text-foreground/70">{repositoryFullName}</span>
            {" "}· powered by AI
          </p>
        )}
      </div>

      {/* Result panel */}
      {result && (
        <ResultPanel result={result} onDismiss={() => setResult(null)} />
      )}

      {/* Setup links */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
        <Link
          href="/dashboard/settings"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          GitHub App &amp; API keys
        </Link>
        <span className="text-muted-foreground/30">·</span>
        <Link
          href="/dashboard/examples"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Workflow examples
        </Link>
        <span className="text-muted-foreground/30">·</span>
        <Link
          href="/dashboard/runs"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          View runs
        </Link>
      </div>
    </div>
  );
}
