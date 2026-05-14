/**
 * All React Query hooks for the app.
 * Keys come from lib/queryKeys.ts — never hardcode strings here.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "./queryKeys";
import type { TokenSummary } from "@/components/settings/settings-client";
import type { ExecutionSnapshot } from "./execution-store";
import type { ExistingPlan } from "./execution-store";


// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function fetchSnapshot(): Promise<ExecutionSnapshot> {
  const res = await fetch("/api/snapshot");
  if (!res.ok) throw new Error("Failed to load snapshot");
  return res.json() as Promise<ExecutionSnapshot>;
}

/** Full dashboard snapshot. Pass `initialData` from server for zero-flash SSR. */
export function useSnapshot(
  opts?: Partial<UseQueryOptions<ExecutionSnapshot>>,
) {
  return useQuery<ExecutionSnapshot>({
    queryKey: queryKeys.snapshot(),
    queryFn: fetchSnapshot,
    staleTime: 20_000,
    gcTime: 5 * 60_000,
    ...opts,
  });
}

/** Imperative invalidator — call after any mutation that changes snapshot data. */
export function useInvalidateSnapshot() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface TokensResponse {
  tokens: TokenSummary[];
}

async function fetchTokens(organizationId: string): Promise<TokenSummary[]> {
  const res = await fetch(`/api/ingestion/tokens?organizationId=${encodeURIComponent(organizationId)}`);
  if (!res.ok) throw new Error("Failed to load tokens");
  const data = await res.json() as TokensResponse;
  return data.tokens;
}

export function useTokens(organizationId: string, initialData?: TokenSummary[]) {
  return useQuery<TokenSummary[]>({
    queryKey: queryKeys.tokens(organizationId),
    queryFn: () => fetchTokens(organizationId),
    initialData,
    initialDataUpdatedAt: initialData ? Date.now() : undefined,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    enabled: !!organizationId,
  });
}

export function useCreateToken(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      const res = await fetch("/api/ingestion/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, name }),
      });
      const data = await res.json() as { token?: string; summary?: TokenSummary; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create token");
      return data as { token: string; summary: TokenSummary };
    },
    onSuccess: ({ summary }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tokens(organizationId) });
      toast.success("API key created", { description: `"${summary.name}" is ready.` });
    },
    onError: (e) =>
      toast.error("Failed to create key", { description: (e as Error).message }),
  });
}

export function useRevokeToken(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ingestion/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tokens(organizationId) });
      toast.success("Key revoked", { description: "The API key has been permanently invalidated." });
    },
    onError: () => toast.error("Failed to revoke key"),
  });
}

// ─── AI Settings ──────────────────────────────────────────────────────────────

export interface AISettingsResponse {
  configured: boolean;
  provider?: string;
  model?: string;
  keyPrefix?: string;
}

async function fetchAISettings(): Promise<AISettingsResponse> {
  const res = await fetch("/api/ai-settings");
  if (!res.ok) throw new Error("Failed to load AI settings");
  return res.json() as Promise<AISettingsResponse>;
}

export function useAISettings() {
  return useQuery<AISettingsResponse>({
    queryKey: queryKeys.aiSettings(),
    queryFn: fetchAISettings,
    staleTime: Infinity,   // user-configured — don't refetch in background
    gcTime: Infinity,
  });
}

export type SaveAIPayload =
  | { provider: string; model: string; apiKey: string }
  | { clear: true };

export function useSaveAISettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SaveAIPayload) => {
      const res = await fetch("/api/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save AI settings");
      return res.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.aiSettings() });
      toast.success("clear" in vars ? "AI model removed" : "AI model saved");
    },
    onError: () => toast.error("Failed to save AI settings"),
  });
}

// ─── Optimization PR ──────────────────────────────────────────────────────────

export interface PRPayload {
  actionId: string;
  repositoryFullName: string;
  runId: string;
  mode: "draft" | "create";
  userFeedback?: string;
}

export interface PRResult {
  mode: "draft" | "created";
  actionId?: string; // echoed back so the caller knows which action this belongs to
  liveCreationEnabled?: boolean;
  plan?: {
    branchName: string;
    files?: { path: string; content: string; operation: string; oldContent?: string }[];
  };
  pullRequest?: { url?: string; number?: number };
  error?: string;
}


export function useCreatePR() {
  return useMutation<PRResult, Error, PRPayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/optimization-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as PRResult;
      // 502 is returned with a body — treat error field as the failure
      if (data.error) throw new Error(data.error);
      // Echo the actionId back so the caller knows what this result belongs to
      return { ...data, actionId: payload.actionId };
    },
    onError: (e) =>
      toast.error("PR creation failed", { description: e.message }),
  });
}

// ─── Existing optimization plans ──────────────────────────────────────────────

async function fetchExistingPlans(repositoryFullName: string, runId: string): Promise<ExistingPlan[]> {
  const res = await fetch(
    `/api/optimization-plans?repo=${encodeURIComponent(repositoryFullName)}&runId=${encodeURIComponent(runId)}`,
  );
  if (!res.ok) return [];
  const data = await res.json() as { plans: ExistingPlan[] };
  return data.plans ?? [];
}

/** Load persisted OptimizationPlanRecords for a run so the UI can show which actions already have PRs. */
export function useExistingPlans(repositoryFullName: string, runId: string) {
  return useQuery<ExistingPlan[]>({
    queryKey: queryKeys.existingPlans(repositoryFullName, runId),
    queryFn: () => fetchExistingPlans(repositoryFullName, runId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: !!repositoryFullName && !!runId,
  });
}

// ─── AI Deep Scan ─────────────────────────────────────────────────────────────

export interface AIScanIssue {
  id: string;
  severity: "warning" | "danger";
  title: string;
  detail: string;
  action: {
    id: string;
    title: string;
    rationale: string;
    estimatedTimeSavingsPct: number;
    estimatedCostSavingsUsdMonthly: number;
    risk: "low" | "medium" | "high";
    filesToChange: string[];
  };
}

export interface AIScanPayload {
  repositoryFullName: string;
  runId: string;
}

export interface AIScanResult {
  issues: AIScanIssue[];
}

export function useAIScan() {
  return useMutation<AIScanResult, Error, AIScanPayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/ai-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as AIScanResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "AI scan failed");
      return data;
    },
    onError: (e) =>
      toast.error("AI scan failed", { description: e.message }),
    onSuccess: (data) => {
      toast.success("AI Scan Complete", { description: `Found ${data.issues.length} new issues.` });
    }
  });
}

