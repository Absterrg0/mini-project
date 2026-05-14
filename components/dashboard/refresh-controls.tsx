"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 10_000;

export function RefreshControls() {
  const qc = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doRefresh = useCallback(
    (silent = false) => {
      setIsRefreshing(true);
      void qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      setTimeout(() => setIsRefreshing(false), 700);
      if (!silent) {
        toast.success("Refreshed", { description: "Data updated.", duration: 2000 });
      }
    },
    [qc],
  );

  useEffect(() => {
    if (isLive) {
      intervalRef.current = setInterval(() => doRefresh(true), POLL_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, doRefresh]);

  function toggleLive() {
    const next = !isLive;
    setIsLive(next);
    toast(next ? "Live updates on" : "Live updates off", {
      description: next ? "Refreshing every 10s via React Query." : "Auto-refresh stopped.",
      duration: 2500,
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => doRefresh(false)}
        disabled={isRefreshing}
        title="Refresh data"
        className="h-7 gap-1.5 rounded border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
      >
        <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
        Refresh
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggleLive}
        title={isLive ? "Disable live updates" : "Enable live updates (every 10 s)"}
        className={`h-7 gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
          isLive
            ? "border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80] hover:bg-[#4ade80]/15"
            : "border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
        }`}
      >
        <Radio size={11} className={isLive ? "animate-pulse" : ""} />
        Live
        {isLive && (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#4ade80]" />
          </span>
        )}
      </Button>
    </div>
  );
}
