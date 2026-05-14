"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 10_000;
const POLL_INTERVAL_SEC = POLL_INTERVAL_MS / 1000;

export function RefreshControls() {
  const qc = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(POLL_INTERVAL_SEC);
  const [liveRefetchFlash, setLiveRefetchFlash] = useState(false);
  const flashClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlashTimeout = useCallback(() => {
    if (flashClearRef.current) {
      clearTimeout(flashClearRef.current);
      flashClearRef.current = null;
    }
  }, []);

  const triggerLiveRefetchFlash = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearFlashTimeout();
    setLiveRefetchFlash(true);
    flashClearRef.current = setTimeout(() => {
      setLiveRefetchFlash(false);
      flashClearRef.current = null;
    }, 300);
  }, [clearFlashTimeout]);

  const doLiveRefetch = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      triggerLiveRefetchFlash();
    } catch {
      /* no flash on failure */
    } finally {
      setTimeout(() => setIsRefreshing(false), 700);
    }
  }, [qc, triggerLiveRefetchFlash]);

  const doManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      toast.success("Dashboard updated", { duration: 2200 });
    } finally {
      setTimeout(() => setIsRefreshing(false), 700);
    }
  }, [qc]);

  useEffect(() => {
    if (!isLive) return;

    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          void doLiveRefetch();
          return POLL_INTERVAL_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(id);
    };
  }, [isLive, doLiveRefetch]);

  useEffect(
    () => () => {
      clearFlashTimeout();
    },
    [clearFlashTimeout],
  );

  function toggleLive() {
    const next = !isLive;
    setIsLive(next);
    if (next) {
      setSecondsLeft(POLL_INTERVAL_SEC);
    }
    toast(next ? "Live updates on" : "Live updates off", {
      description: next
        ? `Refreshing every ${POLL_INTERVAL_SEC}s via React Query.`
        : "Auto-refresh stopped.",
      duration: 2500,
    });
  }

  const liveTitle = isLive
    ? `Disable live updates. Next refresh in ${secondsLeft}s.`
    : `Enable live updates (every ${POLL_INTERVAL_SEC}s)`;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void doManualRefresh()}
        disabled={isRefreshing}
        title="Refresh data"
        className="h-7 shrink-0 gap-1.5 rounded border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
        Refresh
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggleLive}
        title={liveTitle}
        className={`h-7 min-w-0 max-w-[min(100%,9.5rem)] shrink gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors sm:max-w-none ${
          isLive
            ? "border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80] hover:bg-[#4ade80]/15"
            : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
        } ${liveRefetchFlash ? "dash-live-refetch-flash" : ""}`}
      >
        <Radio size={11} className={`shrink-0 ${isLive ? "animate-pulse" : ""}`} />
        <span className="min-w-0 truncate">Live</span>
        {isLive && (
          <>
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              ·{secondsLeft}s
            </span>
            <span className="relative flex size-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#4ade80]" />
            </span>
          </>
        )}
      </Button>
    </div>
  );
}
