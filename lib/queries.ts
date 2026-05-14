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
import { mergeExistingPlansByAction } from "@/lib/ai-scan-carry-forward";


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
    estimatedTimeSavingsPct?: number;
    estimatedCostSavingsUsdMonthly?: number;
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

export interface UseExistingPlansOptions extends Partial<UseQueryOptions<ExistingPlan[]>> {
  /** When AI scan issues are carried from an older run, also load that run’s persisted plans and merge. */
  carryForwardSourceRunId?: string | null;
}

/** Load persisted OptimizationPlanRecords for a run so the UI can show which actions already have PRs. Pass `initialData` from the server to avoid badge/PR icon pop-in on first paint. */
export function useExistingPlans(
  repositoryFullName: string,
  runId: string,
  opts?: UseExistingPlansOptions,
) {
  const { carryForwardSourceRunId, ...queryOpts } = opts ?? {};
  return useQuery<ExistingPlan[]>({
    queryKey: queryKeys.existingPlans(repositoryFullName, runId, carryForwardSourceRunId),
    queryFn: async () => {
      const latest = await fetchExistingPlans(repositoryFullName, runId);
      if (!carryForwardSourceRunId) return latest;
      const prior = await fetchExistingPlans(repositoryFullName, carryForwardSourceRunId);
      return mergeExistingPlansByAction(prior, latest);
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: !!repositoryFullName && !!runId,
    ...queryOpts,
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
  const qc = useQueryClient();

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
      qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      const n = data.issues.length;
      toast.success("AI scan complete", {
        description: n ? `${n} new ${n === 1 ? "issue" : "issues"} recorded.` : "Results updated for the current commit.",
      });
    },
  });
}

// ─── AI Issue Validation ──────────────────────────────────────────────────────

export interface ValidateIssuePayload {
  repositoryFullName: string;
  runId: string;
  issueId: string;
}

export interface ValidateIssueResult {
  valid: boolean;
  reason: string;
}

/** Validate a single outdated AI scan issue against the current run telemetry.
 *  If invalid, the API removes it from the DB and we invalidate the snapshot. */
export function useValidateAIIssue() {
  const qc = useQueryClient();

  return useMutation<ValidateIssueResult, Error, ValidateIssuePayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/ai-scan/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as ValidateIssueResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Validation failed");
      return data;
    },
    onSuccess: (data) => {
      if (!data.valid) {
        // Issue was removed from DB — invalidate snapshot so it doesn't reappear on refresh
        qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      }
    },
    onError: (e) =>
      toast.error("Validation failed", { description: e.message }),
  });
}

// ─── Run Analysis (narrative AI insights) ─────────────────────────────────────

export interface RunAnalysisResult {
  markdown: string;
  model: string;
  createdAt: string;
}

export interface RunAnalysisResponse {
  analysis: RunAnalysisResult | null;
}

export interface AnalyzeRunPayload {
  repositoryFullName: string;
  runId: string;
}

/** Fetch the persisted narrative analysis for a run (no AI call). */
export function useRunAnalysis(runId: string, initialData?: RunAnalysisResult | null) {
  return useQuery<RunAnalysisResult | null>({
    queryKey: queryKeys.runAnalysis(runId),
    queryFn: async () => {
      const res = await fetch(`/api/run-analysis?runId=${encodeURIComponent(runId)}`);
      if (!res.ok) return null;
      const data = await res.json() as RunAnalysisResponse;
      return data.analysis ?? null;
    },
    initialData: initialData !== undefined ? initialData : undefined,
    initialDataUpdatedAt: initialData !== undefined ? Date.now() : undefined,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    enabled: !!runId,
  });
}

/** Trigger a new AI analysis for a run and persist it. */
export function useAnalyzeRun() {
  const qc = useQueryClient();

  return useMutation<RunAnalysisResult, Error, AnalyzeRunPayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/run-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as RunAnalysisResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Analysis failed");
      if (!data.analysis) throw new Error("No analysis returned");
      return data.analysis;
    },
    onSuccess: (data, vars) => {
      qc.setQueryData(queryKeys.runAnalysis(vars.runId), data);
      qc.invalidateQueries({ queryKey: queryKeys.snapshot() });
      toast.success("Analysis complete", { description: "AI insights have been saved for this run." });
    },
    onError: (e) =>
      toast.error("Analysis failed", { description: e.message }),
  });
}

// ─── Test Scaffold PR ──────────────────────────────────────────────────────────

export type TestScaffoldFlavor = "flaky" | "failing" | "slow" | "e2e" | "unit";

export interface GenerateTestsPRPayload {
  repositoryFullName: string;
  flavor: TestScaffoldFlavor;
}

export interface GenerateTestsPRResult {
  draftOnly: boolean;
  files: Array<{ path: string; content: string; summary: string }>;
  branchName: string | null;
  prUrl: string | null;
}

/** Generate AI-authored sample tests and open a PR on GitHub (or return draft files if no GitHub App). */
export function useGenerateTestsPR() {
  return useMutation<GenerateTestsPRResult, Error, GenerateTestsPRPayload>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/test-scaffold-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as GenerateTestsPRResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to generate test scaffold.");
      return data;
    },
    onError: (e) =>
      toast.error("Test scaffold failed", { description: e.message }),
  });
}

