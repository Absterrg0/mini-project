export type RunStatus = "success" | "failed" | "degraded";

export type JobStatus = "success" | "failed" | "flaky";

export type StepStatus = "success" | "failed" | "retried";

export interface StepExecution {
  id: string;
  name: string;
  durationSec: number;
  queueSec: number;
  retries: number;
  status: StepStatus;
  cacheHitRate: number;
  cpuPct: number;
  networkMbps: number;
}

export interface JobExecution {
  id: string;
  name: string;
  dependsOn: string[];
  durationSec: number;
  queueSec: number;
  status: JobStatus;
  runner: string;
  cacheHitRate: number;
  infraUtilization: number;
  steps: StepExecution[];
}

export interface TestSignal {
  name: string;
  file: string;
  runs: number;
  failures: number;
  retries: number;
  avgDurationSec: number;
}

export interface RuntimeTelemetrySample {
  atMs: number;
  cpuPct: number;
  memoryRssMb: number;
  diskReadMb?: number;
  diskWriteMb?: number;
  networkRxMb?: number;
  networkTxMb?: number;
}

export interface RuntimeTelemetry {
  source: "github" | "execforge-wrapper";
  wrapperVersion?: string;
  captureStartedAt?: string;
  captureFinishedAt?: string;
  exitCode?: number;
  machine?: {
    os?: string;
    arch?: string;
    runnerName?: string;
    runnerEnvironment?: string;
    cpuCount?: number;
    totalMemoryMb?: number;
  };
  samples: RuntimeTelemetrySample[];
  artifacts?: Array<{
    name: string;
    path: string;
    sizeBytes?: number;
    sha256?: string;
  }>;
  annotations?: Array<{
    level: "info" | "warning" | "error";
    message: string;
    source?: string;
  }>;
  tests?: Array<{
    name: string;
    file: string;
    durationSec: number;
    failed: boolean;
    failureMessage?: string;
  }>;
}

export interface WorkflowRun {
  id: string;
  repositoryId?: string;
  workflowName: string;
  branch: string;
  commitSha: string;
  startedAt: string;
  status: RunStatus;
  totalDurationSec: number;
  containerLayerReuse: number;
  changedFiles: string[];
  jobs: JobExecution[];
  tests: TestSignal[];
  telemetrySource?: RuntimeTelemetry["source"];
  telemetryWrapperVersion?: string;
  runtimeTelemetry?: RuntimeTelemetry;
  aiScanResult?: unknown;
  /** Commit captured when AI scan issues were last persisted; differs from `commitSha` when telemetry moved on. */
  aiScanScannedCommitSha?: string | null;
  /** Persisted AI narrative analysis for this run. */
  runAnalysis?: { markdown: string; model: string; createdAt: string } | null;
}

export interface OptimizationAction {
  id: string;
  title: string;
  rationale: string;
  estimatedTimeSavingsPct: number;
  estimatedCostSavingsUsdMonthly: number;
  risk: "low" | "medium" | "high";
  filesToChange: string[];
  isAiGenerated?: boolean;
}


export interface PullRequestFileChange {
  path: string;
  operation: "create" | "update";
  summary: string;
  content: string;
  oldContent?: string;
}

export interface OptimizationPullRequestPlan {
  actionId: string;
  repositoryFullName: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  risk: OptimizationAction["risk"];
  estimatedTimeSavingsPct: number;
  estimatedCostSavingsUsdMonthly: number;
  files: PullRequestFileChange[];
  guardrails: string[];
}

export type InstallationStatus =
  | "connected"
  | "indexing"
  | "needs_attention"
  | "not_installed";

export interface RepositoryProfile {
  id: string;
  organizationId: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: "private" | "public";
  language: string;
  team: string;
  monthlyCiMinutes: number;
  monthlyCiSpendUsd: number;
  p95DurationSec: number;
  failureRatePct: number;
  flakeRatePct: number;
  cacheHitRatePct: number;
  runnerUtilizationPct: number;
  telemetryMode: "github" | "execforge-wrapper";
  telemetryScriptVersion?: string;
  selected: boolean;
  lastIndexedAt: string;
}

export interface OrganizationProfile {
  id: string;
  name: string;
  slug: string;
  plan: "trial" | "team" | "enterprise";
  installationStatus: InstallationStatus;
  installationId?: string;
  installationRepositorySelection?: "all" | "selected";
  installationUrl?: string;
  repositories: RepositoryProfile[];
}

export interface IngestionCheck {
  id: string;
  label: string;
  status: "healthy" | "warning" | "blocked";
  detail: string;
  latencyMs: number;
}

export interface IngestionPipeline {
  organizationId: string;
  syncCursor: string;
  eventsProcessed24h: number;
  webhookDeliveryPct: number;
  checks: IngestionCheck[];
}
