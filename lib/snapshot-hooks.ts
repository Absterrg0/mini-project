"use client";

/**
 * Thin client wrappers that hydrate the React Query cache from server-prefetched data.
 * Used with the HydrationBoundary pattern in each page's server component.
 */
import { useSnapshot } from "@/lib/queries";
import type { ExecutionSnapshot } from "@/lib/execution-store";
import type { WorkflowRun, RepositoryProfile } from "@/app/lib/types";

// ─── Type helpers (re-exported for convenience) ────────────────────────────────

export type { ExecutionSnapshot };

// ─── Tiny hook to pull typed slices from the cache ────────────────────────────

/** Returns organisations from the cached snapshot, or falls back to initialData. */
export function useOrganizations(initialData: ExecutionSnapshot) {
  const { data } = useSnapshot({ initialData, initialDataUpdatedAt: Date.now() });
  return data?.organizations ?? initialData.organizations;
}

export function useWorkflowRuns(initialData: ExecutionSnapshot) {
  const { data } = useSnapshot({ initialData, initialDataUpdatedAt: Date.now() });
  return data?.workflowRuns ?? initialData.workflowRuns;
}

export function useRepoRuns(initialData: ExecutionSnapshot, repoId: string | undefined): WorkflowRun[] {
  const runs = useWorkflowRuns(initialData);
  return repoId ? runs.filter((r) => r.repositoryId === repoId) : runs;
}

export function useActiveRepo(initialData: ExecutionSnapshot, repoParam: string | undefined): RepositoryProfile | undefined {
  const orgs = useOrganizations(initialData);
  const org = orgs[0];
  if (!org) return undefined;
  return repoParam
    ? (org.repositories.find((r) => r.id === repoParam) ?? org.repositories[0])
    : org.repositories[0];
}
