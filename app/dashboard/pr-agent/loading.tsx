import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function PrAgentLoading() {
  return (
    <div className="fade-up">
      <header className="dash-topbar">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator orientation="vertical" className="h-4 shrink-0" />
          <span className="shrink-0 text-sm font-medium">PR Agent</span>
          <Separator orientation="vertical" className="h-4 shrink-0" />
          <Skeleton className="hidden h-3.5 max-w-[min(100%,280px)] flex-1 sm:block" />
        </div>
        <Skeleton className="h-[26px] w-[120px] shrink-0 rounded-md" />
      </header>

      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Current", "Projected", "Saved"].map((label) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-card p-4"
            >
              <Skeleton className="mb-2 h-2.5 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-0 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="border-border px-4 py-3 sm:border-r sm:last:border-r-0"
              >
                <Skeleton className="mb-2 h-2 w-12" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-7 w-[140px] shrink-0 rounded-md" />
          </div>
          <div className="hidden gap-3 border-b border-border bg-secondary px-4 py-1.5 sm:grid" style={{ gridTemplateColumns: "20px 1fr 110px 90px 60px 128px" }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-2.5 w-full max-w-[72px]" />
            ))}
          </div>
          <div className="flex flex-col divide-y divide-border">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="size-3.5 shrink-0 rounded" />
                <Skeleton className="h-3.5 min-w-0 flex-1 max-w-md" />
                <Skeleton className="hidden h-3 w-14 sm:block" />
                <Skeleton className="hidden h-3 w-12 sm:block" />
                <Skeleton className="hidden h-5 w-10 sm:block" />
                <Skeleton className="ml-auto hidden h-7 w-24 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
