"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TriggerWorkflowButtonProps {
  repositoryFullName: string;
  workflowId: string | number;
  defaultBranch?: string;
  label?: string;
}

type State = "idle" | "loading" | "success" | "error";

export function TriggerWorkflowButton({
  repositoryFullName,
  workflowId,
  defaultBranch = "main",
  label = "Rerun",
}: TriggerWorkflowButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");

  async function handleTrigger() {
    if (state === "loading") return;
    setState("loading");

    try {
      const res = await fetch("/api/github/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryFullName,
          workflowId,
          ref: defaultBranch,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setState("success");
      toast.success("Workflow triggered", {
        description: `Dispatched on ${defaultBranch}. Refreshing…`,
        duration: 3000,
      });
      router.refresh();

      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      setState("error");
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to trigger workflow", { description: msg, duration: 4000 });
      setTimeout(() => setState("idle"), 4000);
    }
  }

  const Icon =
    state === "loading"
      ? Loader2
      : state === "success"
        ? CheckCircle2
        : state === "error"
          ? AlertCircle
          : RotateCcw;

  const colorClass =
    state === "success"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15"
      : state === "error"
        ? "text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/15"
        : "text-muted-foreground border-border bg-transparent hover:bg-muted/50 hover:text-foreground";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleTrigger();
      }}
      disabled={state === "loading"}
      title={`Trigger "${label}" on ${defaultBranch}`}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${colorClass}`}
    >
      <Icon
        size={9}
        className={state === "loading" ? "animate-spin" : ""}
        aria-hidden
      />
      {label}
    </button>
  );
}
