/**
 * Centralized query key factory.
 * All keys are typed tuples so refactors are caught at compile time.
 * Usage: queryClient.invalidateQueries({ queryKey: queryKeys.snapshot() })
 */
export const queryKeys = {
  /** Full execution snapshot — organizations, workflow runs, pipelines */
  snapshot: () => ["snapshot"] as const,

  /** Ingestion tokens for a given org */
  tokens: (organizationId: string) => ["tokens", organizationId] as const,

  /** AI / BYOK settings stored in httpOnly cookie */
  aiSettings: () => ["ai-settings"] as const,

  /** A single optimization PR plan (draft or created) */
  prPlan: (actionId: string, runId: string) =>
    ["pr-plan", actionId, runId] as const,

  /** Persisted OptimizationPlanRecords for a given repo + run */
  existingPlans: (repositoryFullName: string, runId: string) =>
    ["existing-plans", repositoryFullName, runId] as const,
} as const;

