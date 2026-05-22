"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FlaskConical,
  GitPullRequest,
  Globe,
  Loader2,
  Sparkles,
  TestTube2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGenerateTestsPR,
  useTestScaffoldJob,
  type GenerateTestsPRResult,
  type TestScaffoldFlavor,
} from "@/lib/queries";

const FLAVORS: Array<{
  id: TestScaffoldFlavor;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: "flaky",
    label: "Flaky Tests",
    shortLabel: "Flaky",
    description: "Timing and race-condition specs against real repo code.",
    icon: <Zap size={14} />,
  },
  {
    id: "failing",
    label: "Failing Tests",
    shortLabel: "Failing",
    description: "Deterministic red-path assertions for failure analytics.",
    icon: <AlertTriangle size={14} />,
  },
  {
    id: "slow",
    label: "Slow Tests",
    shortLabel: "Slow",
    description: "Duration-heavy tests for bottleneck and timeout demos.",
    icon: <Clock size={14} />,
  },
  {
    id: "e2e",
    label: "E2E Tests",
    shortLabel: "E2E",
    description: "Integration-style coverage for flows and navigation.",
    icon: <Globe size={14} />,
  },
  {
    id: "unit",
    label: "Unit Tests",
    shortLabel: "Unit",
    description: "Focused specs around modules, helpers, and edge cases.",
    icon: <TestTube2 size={14} />,
  },
];

function ScaffoldResult({ result }: { result: GenerateTestsPRResult }) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  function copyFile(content: string, path: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1800);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-background/70 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitPullRequest size={14} className="text-emerald-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {result.prUrl ? "Template PR opened" : "Template files generated"}
            </p>
            <p className="text-[11px] font-mono text-muted-foreground truncate">
              {result.branchName ?? `${result.files.length} generated files`}
            </p>
          </div>
        </div>
        {result.prUrl && (
          <a
            href={result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
          >
            <ExternalLink size={12} />
            Open PR
          </a>
        )}
      </div>
      {result.files.length > 0 && (
        <div className="divide-y divide-border/70">
          {result.files.slice(0, 3).map((file) => (
            <div key={file.path} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-mono text-foreground">{file.path}</p>
                <p className="truncate text-[11px] text-muted-foreground">{file.summary}</p>
              </div>
              <button
                onClick={() => copyFile(file.content, file.path)}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {copiedPath === file.path ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copiedPath === file.path ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TestScaffoldLauncher({
  repositoryFullName,
  existingTestCount,
}: {
  repositoryFullName?: string;
  existingTestCount: number;
}) {
  const [selected, setSelected] = useState<TestScaffoldFlavor>("flaky");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const notifiedJobId = useRef<string | null>(null);
  const generate = useGenerateTestsPR();
  const { data: activeJob } = useTestScaffoldJob(activeJobId);
  const selectedFlavor = useMemo(() => FLAVORS.find((flavor) => flavor.id === selected) ?? FLAVORS[0], [selected]);
  const isTerminalJob = activeJob?.status === "completed" || activeJob?.status === "failed";
  const isGenerating = generate.isPending || Boolean(activeJobId && !isTerminalJob);
  const result = activeJob?.status === "completed" && activeJob.jobId !== dismissedJobId ? activeJob : null;

  useEffect(() => {
    if (!activeJob || notifiedJobId.current === activeJob.jobId) return;

    if (activeJob.status === "completed") {
      notifiedJobId.current = activeJob.jobId;
      toast.success(activeJob.prUrl ? "Template PR opened" : "Template files generated", {
        description: activeJob.prUrl
          ? "ExecForge used the current repository context, including existing tests."
          : "Review the generated files before applying them.",
      });
    }

    if (activeJob.status === "failed") {
      notifiedJobId.current = activeJob.jobId;
      toast.error("Template PR failed", {
        description: activeJob.error ?? "The background scaffold job failed.",
      });
    }
  }, [activeJob]);

  function generateTemplate() {
    if (!repositoryFullName) {
      toast.error("No repository selected", {
        description: "Choose a repository before generating template tests.",
      });
      return;
    }

    generate.mutate(
      { repositoryFullName, flavor: selected },
      {
        onSuccess: (data) => {
          notifiedJobId.current = null;
          setDismissedJobId(null);
          setActiveJobId(data.jobId);
          toast.info("Template PR started", {
            description: "ExecForge is reading source files and existing tests before opening the PR.",
          });
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FlaskConical size={15} className="text-[#a5b4fc]" />
            <h2 className="text-sm font-semibold">Template PRs</h2>
            <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              {existingTestCount} existing signals
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Generate repo-aware test PRs from the current source tree and existing test files. Use these to seed fresh flake, failure, slow, E2E, or unit signals without losing the context already in the repo.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-background p-1">
            {FLAVORS.map((flavor) => {
              const isSelected = selected === flavor.id;
              return (
                <button
                  key={flavor.id}
                  type="button"
                  onClick={() => setSelected(flavor.id)}
                  className={`inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
                    isSelected
                      ? "bg-[#a5b4fc] text-[#111111]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={flavor.description}
                  aria-pressed={isSelected}
                >
                  {flavor.icon}
                  <span className="hidden md:inline">{flavor.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <Button
            onClick={generateTemplate}
            disabled={isGenerating || !repositoryFullName}
            className="h-9 shrink-0 gap-2"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {isGenerating ? "Opening PR..." : `Raise ${selectedFlavor.shortLabel} PR`}
          </Button>
        </div>
      </div>
      {activeJob?.status === "failed" && (
        <div className="border-t border-border px-4 py-3 text-xs text-red-300">
          {activeJob.error ?? "Template PR failed."}
        </div>
      )}
      {result && (
        <div className="border-t border-border p-4">
          <ScaffoldResult result={result} />
          <button
            type="button"
            onClick={() => setDismissedJobId(result.jobId)}
            className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Hide result
          </button>
        </div>
      )}
    </section>
  );
}
