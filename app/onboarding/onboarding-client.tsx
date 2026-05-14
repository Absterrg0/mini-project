"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  GitBranch,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import type { IngestionPipeline, OrganizationProfile } from "@/app/lib/types";
import type { RepositoryTelemetryCoverage } from "@/lib/telemetry-analytics";
import { Checkbox } from "@/components/ui/checkbox";
import { rankRepositoriesByWaste } from "@/app/lib/intelligence";
import { Button } from "@/components/ui/button";


// ─── Types ───────────────────────────────────────────────────────────────────

interface OnboardingClientProps {
  organizations: OrganizationProfile[];
  pipelines: IngestionPipeline[];
  coverageByOrgId: Record<string, RepositoryTelemetryCoverage[]>;
  githubAppName: string;
  /** The signed-in user's GitHub username (e.g. "Absterrg0") */
  githubUsername: string;
  /** Full GitHub install page URL, null if GITHUB_APP_SLUG is not set */
  installUrl: string | null;
  /** True when GitHub just redirected back after a successful installation */
  justInstalled: boolean;
  /** Error message from the callback, null on success */
  installError: string | null;
}

type Step = "connect" | "repos" | "done";

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect"      },
  { id: "repos",   label: "Repositories" },
  { id: "done",    label: "Done"         },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="step-indicator">
      {STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
            <div className={`step-node ${done ? "done" : active ? "active" : ""}`}>
              <div className="step-circle">
                {done ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              <span style={{ whiteSpace: "nowrap" }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector ${done ? "done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function OnboardingClient({
  organizations,
  pipelines: _pipelines,
  coverageByOrgId: _coverageByOrgId,
  githubAppName,
  githubUsername,
  installUrl,
  justInstalled,
  installError,
}: OnboardingClientProps) {
  const router = useRouter();

  /**
   * Determine the starting step from server-provided props — no client-side
   * guesswork, no hydration mismatch.
   *
   * justInstalled → repos  (just came back from GitHub install)
   * otherwise     → connect
   */
  const initialStep: Step = justInstalled ? "repos" : "connect";

  const [step, setStep]           = useState<Step>(initialStep);
  const selectedOrg               = organizations[0];
  const rankedRepos               = selectedOrg
    ? rankRepositoriesByWaste(selectedOrg.repositories)
    : [];
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>(
    rankedRepos.map((r) => r.id), // pre-select all by default
  );

  return (
    <>
      {step === "connect" && (
        <StepConnect
          githubAppName={githubAppName}
          installUrl={installUrl}
          githubUsername={githubUsername}
          installError={installError}
          onNext={() => setStep("repos")}
          onBack={() => router.push("/sign-in")}
        />
      )}

      {step === "repos" && (
        <StepRepos
          repos={rankedRepos}
          selectedIds={selectedRepoIds}
          onToggle={(id, checked) =>
            setSelectedRepoIds((prev) =>
              checked ? [...prev, id] : prev.filter((x) => x !== id)
            )
          }
          onNext={() => setStep("done")}
          onBack={() => setStep("connect")}
        />
      )}

      {step === "done" && (
        <StepDone
          selectedCount={selectedRepoIds.length}
          orgId={selectedOrg?.id}
          onGo={() => router.push("/dashboard")}
        />
      )}
    </>
  );
}

// ─── Step: Connect GitHub App ─────────────────────────────────────────────────

function StepConnect({
  githubAppName,
  installUrl,
  githubUsername,
  installError,
  onNext,
  onBack,
}: {
  githubAppName: string;
  installUrl: string | null;
  githubUsername: string;
  installError: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Shell
      step="connect"
      title="Connect GitHub App"
      sub="Install the app on your account to grant access to your repositories."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Error banner from a previous failed callback */}
        {installError && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)",
          }}>
            <AlertCircle size={15} style={{ color: "var(--color-danger)", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 600, color: "var(--color-danger)" }}>
                Installation failed
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                {installError}
              </p>
            </div>
          </div>
        )}

        {/* ── Install card ── */}
        <Card
          label="1"
          title={`Install ${githubAppName}`}
          description={
            <>
              Grants read access to Actions, checks, and workflows for{" "}
              <strong style={{ color: "var(--foreground)" }}>{githubUsername}</strong>.
              After clicking Save on GitHub, you&apos;ll be redirected back automatically.
            </>
          }
        >
          {installUrl ? (
            <a
              href={installUrl}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 6,
                background: "var(--foreground)", color: "var(--background)",
                fontSize: 13, fontWeight: 500, textDecoration: "none",
              }}
            >
              <GitBranch size={13} />
              Install {githubAppName}
              <ExternalLink size={11} style={{ opacity: 0.6 }} />
            </a>
          ) : (
            <Warn>
              Set <Mono>GITHUB_APP_SLUG</Mono> in <Mono>.env</Mono> to enable the install button.
            </Warn>
          )}
        </Card>

        <Nav onBack={onBack} onNext={onNext} nextLabel="Continue" />
      </div>
    </Shell>
  );
}

// ─── Step: Repository selection ───────────────────────────────────────────────

function StepRepos({
  repos,
  selectedIds,
  onToggle,
  onNext,
  onBack,
}: {
  repos: ReturnType<typeof rankRepositoriesByWaste>;
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Shell
      step="repos"
      title="Select repositories"
      sub="Choose which repos to monitor. You can change this later."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {repos.length > 0 ? (
          repos.map((repo) => {
            const checked = selectedIds.includes(repo.id);
            return (
              <label
                key={repo.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${checked ? "var(--ring)" : "var(--border)"}`,
                  background: checked ? "var(--secondary)" : "var(--card)",
                  transition: "border-color 120ms, background 120ms",
                }}
              >
                <Checkbox
                  checked={checked}
                  onChange={(e) => onToggle(repo.id, e.target.checked)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, fontFamily: "var(--font-mono)" }}>
                    {repo.fullName}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                    {repo.language} · {repo.visibility}
                    {repo.wasteUsd > 0 && ` · $${repo.wasteUsd}/mo waste`}
                  </p>
                </div>
              </label>
            );
          })
        ) : (
          <EmptyRepos />
        )}

        <Nav
          onBack={onBack}
          onNext={onNext}
          nextLabel="Finish setup"
          nextDisabled={selectedIds.length === 0}
        />
      </div>
    </Shell>
  );
}

function EmptyRepos() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      padding: "32px 16px", textAlign: "center",
      borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)",
    }}>
      <AlertCircle size={22} strokeWidth={1.5} style={{ color: "var(--muted-foreground)" }} />
      <div>
        <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 500 }}>No repositories synced</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", maxWidth: 340, lineHeight: 1.6 }}>
          Go back and reinstall the GitHub App. Make sure the{" "}
          <strong>Callback URL</strong> in your GitHub App settings points to{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em" }}>/api/github/app/callback</code>.
        </p>
      </div>
    </div>
  );
}

// ─── Step: Done ───────────────────────────────────────────────────────────────

function StepDone({
  selectedCount,
  orgId,
  onGo,
}: {
  selectedCount: number;
  orgId?: string;
  onGo: () => void;
}) {
  const [token, setToken]         = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(Boolean(orgId));
  const [tokenError, setTokenError]   = useState("");
  const [copied, setCopied]       = useState(false);

  // Generate a real ingestion token via the API route (server-side creation)
  useEffect(() => {
    if (!orgId) return;
    fetch("/api/ingestion/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, name: "CI pipeline" }),
    })
      .then((r) => r.json())
      .then((data: { token?: string; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setToken(data.token ?? null);
      })
      .catch((e: unknown) => {
        setTokenError(e instanceof Error ? e.message : "Failed to generate token.");
      })
      .finally(() => setTokenLoading(false));
  // Run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyToken() {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Shell
      step="done"
      title="You're all set"
      sub={`${selectedCount} ${selectedCount === 1 ? "repository" : "repositories"} ready for ingestion.`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Completion checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "GitHub App installed & connected",
            `${selectedCount} repositories selected`,
          ].map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted-foreground)" }}>
              <CheckCircle2 size={14} style={{ color: "var(--color-success)", flexShrink: 0 }} />
              {item}
            </div>
          ))}
        </div>

        {/* API token card */}
        <div style={{
          borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden",
        }}>
          <div style={{
            padding: "9px 14px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--secondary)",
          }}>
            <KeyRound size={12} style={{ color: "var(--muted-foreground)" }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Your API token</span>
          </div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
              Add this as a GitHub secret named{" "}
              <Mono>EXECFORGE_API_TOKEN</Mono> in the repositories you want to monitor.
              The SDK uses it to send telemetry.
            </p>

            {tokenLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
                <Loader2 size={13} className="animate-spin" />
                Generating token…
              </div>
            )}

            {tokenError && (
              <Warn>{tokenError} — generate one later in Settings → API Keys.</Warn>
            )}

            {!tokenLoading && !tokenError && token && (
              <>
                <CopyRow value={token} copied={copied} onCopy={copyToken} />
                <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                  Copy it now — it won&apos;t be shown again. Generate more tokens any time in Settings.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Workflow snippet card */}
        <WorkflowCard token={token} />


        <Btn onClick={onGo}>
          Open dashboard <ArrowRight size={14} />
        </Btn>
      </div>
    </Shell>
  );
}

// ─── Workflow card (shown in Done step) ───────────────────────────────────────

function WorkflowCard({ token }: { token: string | null }) {
  type Tab = "minimal" | "full";
  const [tab, setTab]     = useState<Tab>("minimal");
  const [copied, setCopied] = useState(false);

  const minimalSnippet = `steps:
  - uses: Absterrg0/execforge-runtime/start@v1
    env:
      EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}

  # ... your existing steps go here ...

  - uses: Absterrg0/execforge-runtime/finish@v1
    if: always()
    env:
      EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
      EXECFORGE_JOB_STATUS: \${{ job.status }}`;

  const fullSnippet = `name: CI

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: Absterrg0/execforge-runtime/start@v1
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci && npm test

      - uses: Absterrg0/execforge-runtime/finish@v1
        if: always()
        env:
          EXECFORGE_API_TOKEN: \${{ secrets.EXECFORGE_API_TOKEN }}
          EXECFORGE_JOB_STATUS: \${{ job.status }}`;

  const content = tab === "minimal" ? minimalSnippet : fullSnippet;

  function copy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 5,
    cursor: "pointer",
    border: "none",
    background: tab === t ? "var(--foreground)" : "transparent",
    color: tab === t ? "var(--background)" : "var(--muted-foreground)",
    transition: "background 120ms, color 120ms",
  });

  return (
    <div style={{ borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "9px 14px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--secondary)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GitBranch size={12} style={{ color: "var(--muted-foreground)" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Workflow setup</span>
        </div>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--card)", borderRadius: 7, border: "1px solid var(--border)" }}>
          <Button type="button" size="sm" variant={tab === "minimal" ? "default" : "ghost"} onClick={() => setTab("minimal")} className="h-6 rounded px-3 text-[11px]">
            Minimal
          </Button>
          <Button type="button" size="sm" variant={tab === "full" ? "default" : "ghost"} onClick={() => setTab("full")} className="h-6 rounded px-3 text-[11px]">
            Full example
          </Button>
        </div>

      </div>

      {/* Body */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {tab === "minimal" ? (
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            Wrap your steps with <Mono>start</Mono> / <Mono>finish</Mono> — the action is cached by GitHub so it adds{" "}<strong style={{ color: "var(--foreground)" }}>zero download overhead</strong> to your workflow:
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            Copy this complete <Mono>.github/workflows/ci.yml</Mono> into your repo. Uses the cached action pattern — no{" "}<Mono>npx</Mono> installs, no extra time added:
          </p>
        )}

        {/* Code block with copy button */}
        <div style={{ position: "relative" }}>
          <pre style={{
            margin: 0, padding: "10px 12px",
            background: "var(--secondary)", border: "1px solid var(--border)",
            borderRadius: 6, fontSize: 11, fontFamily: "var(--font-mono)",
            color: "var(--foreground)", overflowX: "auto", lineHeight: 1.8,
            whiteSpace: "pre",
          }}>{content}</pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            title="Copy"
            className="absolute top-2 right-2 h-6 gap-1 rounded px-2 text-[10px] font-mono text-muted-foreground"
          >
            {copied ? <><Check size={10} style={{ color: "var(--color-success)" }} /> copied</> : <><Copy size={10} /> copy</>}
          </Button>

        </div>

        {tab === "full" && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            💡 Make sure <Mono>EXECFORGE_API_TOKEN</Mono> is added as a GitHub secret before pushing.
            {token ? " Your token was generated above — add it now." : ""}
          </p>
        )}
      </div>
    </div>
  );
}


function Shell({
  step,
  title,
  sub,
  children,
}: {
  step: Step;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="onboard-shell">
      <div style={{ width: "100%", maxWidth: 540 }} className="fade-up">
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 36 }}>
          <div style={{
            width: 24, height: 24, background: "var(--foreground)", borderRadius: 4,
            display: "grid", placeItems: "center",
            fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--background)",
          }}>
            EF
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>ExecForge</span>
        </div>

        <StepIndicator current={step} />

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {title}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted-foreground)" }}>{sub}</p>
        </div>

        {children}
      </div>
    </div>
  );
}

// ─── Back / Next nav ──────────────────────────────────────────────────────────

function Nav({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--border)",
    }}>
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        className="rounded-md px-4 py-2 text-[13px] text-muted-foreground"
      >
        Back
      </Button>

      <Btn onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <ArrowRight size={13} />
      </Btn>
    </div>
  );
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function Card({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{
        padding: "9px 14px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--secondary)",
      }}>
        <span style={{
          fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
          color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}

function CopyRow({ value, copied, onCopy }: { value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 12px", background: "var(--secondary)",
      borderRadius: 6, border: "1px solid var(--border)",
    }}>
      <code style={{
        flex: 1, fontFamily: "var(--font-mono)", fontSize: 11,
        color: "var(--foreground)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCopy}
        title="Copy"
        className="shrink-0 h-auto p-1 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check size={13} style={{ color: "var(--color-success)" }} /> : <Copy size={13} />}
      </Button>

    </div>
  );
}

function Btn({
  children,
  onClick,
  type = "button",
  disabled = false,
  full = false,
  style: extraStyle = {},
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 6, padding: "8px 16px", borderRadius: 6,
        background: "var(--foreground)", color: "var(--background)",
        fontSize: 13, fontWeight: 500, border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        width: full ? "100%" : undefined,
        ...extraStyle,
      }}
    >
      {children}
    </button>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "9px 12px", borderRadius: 6,
      background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.2)",
    }}>
      <AlertCircle size={13} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: 1 }} />
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-warning)" }}>{children}</p>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em" }}>{children}</code>
  );
}
