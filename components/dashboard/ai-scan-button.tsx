"use client";

import { useAIScan } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export function AIScanButton({ repositoryFullName, runId, alreadyScanned }: { repositoryFullName: string; runId: string; alreadyScanned: boolean }) {
  const { mutate: runScan, isPending } = useAIScan();
  const router = useRouter();

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              onClick={() => {
                runScan({ repositoryFullName, runId }, {
                  onSuccess: () => {
                    router.refresh();
                  }
                });
              }}
              disabled={isPending}
              className="h-[26px] px-2.5 text-[11px] gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-md transition-all shadow-sm"
            >
              {isPending ? <Loader2 size={12} className="animate-spin" /> : alreadyScanned ? <RefreshCw size={10} /> : <Sparkles size={12} />}
              {isPending ? "Scanning..." : alreadyScanned ? "Scan for more" : "AI Deep Scan"}
            </Button>
          }
        />
        <TooltipContent side="bottom" align="end" className="max-w-[250px] text-xs">
          <p>Run a comprehensive AI scan over your workflow telemetry to find complex issues that standard rules might miss.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
