"use client";

import React, { useState } from "react";
import {
  Key, Plus, Trash2, Copy, Check, Eye, EyeOff,
  Loader2, Clock, Shield, X, GitBranch, RefreshCw,
  AlertTriangle, ChevronRight, BrainCircuit, CheckCircle2,
  User, Cpu, Info,
} from "lucide-react";



import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
  AlertDialogAction, AlertDialogMedia,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";


import { AI_MODELS, type AIProvider } from "@/lib/ai-provider";
import { useAISettings, useSaveAISettings, useTokens, useCreateToken, useRevokeToken } from "@/lib/queries";

export interface TokenSummary {
  id: string; name: string; scope: string; tokenPrefix: string;
  lastFour: string; status: string; createdAt: string;
  lastUsedAt?: string; expiresAt?: string;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("Copied to clipboard");
      }}
      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-[#4ade80]" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Base card ─────────────────────────────────────────────────────────────────

function BaseCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#111] border border-white/[0.07] ${className}`}>
      {children}
    </div>
  );
}

function CardSection({ icon: Icon, title, description, children }: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <BaseCard>
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
        <div className="size-7 bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
          <Icon size={13} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children && <div className="px-5 py-4">{children}</div>}
    </BaseCard>
  );
}

// ─── KV row ────────────────────────────────────────────────────────────────────

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-8 py-3 border-b border-white/[0.04] last:border-0">
      <span className="w-28 shrink-0 text-[11px] text-muted-foreground font-medium">{label}</span>
      <div className="flex-1 text-sm text-foreground/90">{children}</div>
    </div>
  );
}

// ─── Premium settings page ─────────────────────────────────────────────────────

export interface SettingsData {
  userName: string;
  userEmail: string;
  orgName?: string;
  orgPlan?: string;
  repoCount: number;
  installationStatus?: string;
  installationRepositorySelection?: string;
  configureUrl: string | null;
  organizationId?: string;
  initialTokens: TokenSummary[];
  connected: boolean;
}

export function SettingsClientPage({ data }: { data: SettingsData }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl py-10 px-6 space-y-4">

        {/* ── Account ── */}
        <CardSection icon={User} title="Account" description="Your profile and organization details">
          <div className="space-y-0">
            <KV label="Name"><span className="font-medium">{data.userName || "—"}</span></KV>
            <KV label="Email"><span className="font-mono text-[12px] text-muted-foreground">{data.userEmail || "—"}</span></KV>
            <KV label="Organization"><span className="font-medium">{data.orgName || "—"}</span></KV>
            <KV label="Plan">
              <span className="font-medium">
                {data.orgPlan ? data.orgPlan.charAt(0).toUpperCase() + data.orgPlan.slice(1) : "—"}
              </span>
            </KV>
            <KV label="Repositories"><span className="font-mono text-sm">{data.repoCount}</span></KV>
          </div>
        </CardSection>

        {/* ── GitHub App ── */}
        <CardSection icon={GitBranch} title="GitHub App" description="Installation and repository access">
          <div className={`flex items-center gap-4 px-4 py-3 border ${
            data.connected
              ? "border-[#4ade80]/20 bg-[#4ade80]/[0.04]"
              : "border-white/[0.06] bg-white/[0.02]"
          }`}>
            <div className={`size-8 flex items-center justify-center shrink-0 ${
              data.connected ? "bg-[#4ade80]/10" : "bg-white/[0.04]"
            }`}>
              <GitBranch size={13} className={data.connected ? "text-[#4ade80]" : "text-muted-foreground"} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{data.connected ? "Connected" : "Not installed"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.installationRepositorySelection === "all"
                  ? `All repositories · ${data.repoCount} synced`
                  : data.installationRepositorySelection === "selected"
                  ? `${data.repoCount} selected repositories`
                  : "Install the GitHub App to start syncing"}
              </p>
            </div>
            {data.configureUrl && (
              <a
                href={data.configureUrl}
                className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw size={10} />
                {data.connected ? "Manage" : "Install"}
                <ChevronRight size={10} />
              </a>
            )}
          </div>
        </CardSection>

        {/* ── API Keys ── */}
        <CardSection
          icon={Key}
          title="API Keys"
          description="Set as EXECFORGE_API_TOKEN in GitHub Actions secrets."
        >
          {data.organizationId ? (
            <ApiKeys organizationId={data.organizationId} initialTokens={data.initialTokens} />
          ) : (
            <p className="text-sm text-muted-foreground">Connect the GitHub App to generate API keys.</p>
          )}
        </CardSection>

        {/* ── AI Model ── */}
        <CardSection
          icon={Cpu}
          title="AI Model"
          description="Used for analysis across PR Agent, Tests, and Runs. Stored in an httpOnly cookie only."
        >
          <BYOKSection />
        </CardSection>

        {/* ── Danger Zone ── */}
        {data.organizationId && (
          <BaseCard className="border-[#f87171]/15">
            <div className="px-5 py-4 border-b border-[#f87171]/10 flex items-center gap-3">
              <div className="size-7 bg-[#f87171]/8 border border-[#f87171]/20 flex items-center justify-center shrink-0">
                <AlertTriangle size={13} className="text-[#f87171]/70" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#f87171]/80">Danger Zone</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Irreversible actions</p>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Revoke all API keys</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Immediately invalidates every active token.
                </p>
              </div>
              <button
                type="button"
                disabled
                className="shrink-0 border border-[#f87171]/20 px-4 py-2 text-xs font-semibold text-[#f87171]/50 disabled:cursor-not-allowed"
              >
                Revoke all
              </button>
            </div>
          </BaseCard>
        )}

      </div>
    </div>
  );
}

// ─── API Keys ──────────────────────────────────────────────────────────────────

export function ApiKeys({ organizationId, initialTokens }: {
  organizationId: string;
  initialTokens: TokenSummary[];
}) {
  const { data: tokens = [], isLoading } = useTokens(organizationId, initialTokens);
  const { mutate: doCreate, isPending: creating, data: newTokenData, reset: resetCreate } = useCreateToken(organizationId);
  const { mutate: doRevoke, isPending: revoking } = useRevokeToken(organizationId);

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [nameError, setNameError] = useState("");

  const activeCount = tokens.filter((t) => t.status === "active").length;
  const newToken = newTokenData?.token ?? null;
  const isPending = creating || revoking;

  function createToken() {
    if (!newName.trim()) { setNameError("Name is required."); return; }
    setNameError("");
    doCreate({ name: newName.trim() }, {
      onSuccess: () => { setNewName(""); setCreateOpen(false); },
    });
  }

  function revokeToken(id: string) {
    doRevoke(id, { onSuccess: () => setRevokeId(null) });
  }

  return (
    <div className="space-y-3">
      {/* New token banner */}
      {newToken && (
        <div className="border border-[#4ade80]/20 bg-[#4ade80]/[0.04] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#4ade80]">Copy your key — won&apos;t be shown again</p>
            <button type="button" onClick={() => { resetCreate(); setShowToken(false); }}
              className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
          </div>
          <div className="flex items-center gap-2 bg-black/30 border border-white/[0.08] px-3 py-2">
            <code className="flex-1 font-mono text-xs truncate text-foreground/80">
              {showToken ? newToken : `${newToken.slice(0, 8)}${"•".repeat(Math.max(0, newToken.length - 12))}${newToken.slice(-4)}`}
            </code>
            <button type="button" onClick={() => setShowToken((v) => !v)} className="text-muted-foreground hover:text-foreground">
              {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <CopyBtn value={newToken} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${activeCount > 0 ? "bg-[#4ade80]" : "bg-white/20"}`} />
          <span className="text-xs text-muted-foreground">{activeCount} active</span>
        </div>
        <button
          type="button"
          onClick={() => { setCreateOpen(true); setNameError(""); }}
          className="inline-flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.07] px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus size={11} /> New key
        </button>
      </div>

      {/* List */}
      {tokens.length === 0 ? (
        <div className="border border-white/[0.07] py-10 flex flex-col items-center gap-2">
          <Key size={18} strokeWidth={1.5} className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No API keys yet</p>
        </div>
      ) : (
        <div className="border border-white/[0.07] overflow-hidden divide-y divide-white/[0.04]">
          {tokens.map((token) => (
            <div key={token.id} className={`flex items-center gap-3 px-4 py-3 ${token.status === "revoked" ? "opacity-30" : "hover:bg-white/[0.03]"} transition-colors`}>
              <div className="size-6 bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0">
                {token.status === "revoked"
                  ? <Shield size={11} className="text-muted-foreground" />
                  : <Key size={11} className="text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{token.name}</span>
                  {token.status === "revoked" && (
                    <span className="text-[9px] px-1 py-0.5 bg-[#f87171]/10 text-[#f87171]/70 font-bold tracking-wide">REVOKED</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="text-[11px] font-mono text-muted-foreground">{token.tokenPrefix}…{token.lastFour}</code>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  {token.lastUsedAt
                    ? <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock size={9} />{timeAgo(token.lastUsedAt)}</span>
                    : <span className="text-[10px] text-muted-foreground">never used</span>}
                </div>
              </div>
              {token.status === "active" && (
                <button type="button" onClick={() => setRevokeId(token.id)} disabled={isPending}
                  className="shrink-0 p-1 text-muted-foreground hover:text-[#f87171] hover:bg-[#f87171]/10 transition-colors">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give this key a name to identify which pipeline it belongs to.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Production CI"
              onKeyDown={(e) => e.key === "Enter" && createToken()} className="font-mono text-sm" autoFocus />
            {nameError && <p className="text-xs text-[#f87171]">{nameError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); setNameError(""); setNewName(""); }}>Cancel</Button>
            <Button size="sm" onClick={createToken} disabled={isPending}>
              {isPending ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Key size={12} className="mr-1.5" />}Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeId} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-[#f87171]/10 text-[#f87171]"><AlertTriangle /></AlertDialogMedia>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>Integrations using this key will immediately stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={() => revokeId && revokeToken(revokeId)}>
              {isPending && <Loader2 size={12} className="animate-spin mr-1.5" />}Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Premium model picker ──────────────────────────────────────────────────────

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Per-model metadata for tier labeling */
const MODEL_META: Record<string, { tier: "fast" | "balanced" | "powerful"; desc: string }> = {
  // OpenAI
  "gpt-5.5":      { tier: "powerful",  desc: "Latest flagship · best quality" },
  "gpt-5.4":      { tier: "balanced",  desc: "Capable · cost-effective" },
  "gpt-5.4-mini": { tier: "fast",      desc: "Fastest GPT-5 · low cost" },
  "gpt-4o":       { tier: "balanced",  desc: "Strong · multimodal" },
  "gpt-4o-mini":  { tier: "fast",      desc: "Lightweight · budget-friendly" },
  // Anthropic
  "claude-opus-4-7":           { tier: "powerful",  desc: "Flagship · complex agentic tasks" },
  "claude-sonnet-4-6":         { tier: "balanced",  desc: "Professional · sharp reasoning" },
  "claude-haiku-4-5-20251001": { tier: "fast",      desc: "Ultra-fast · cost-efficient" },
  "claude-opus-4-5":           { tier: "powerful",  desc: "High capability · long context" },
  "claude-sonnet-4-5":         { tier: "balanced",  desc: "Balanced · reliable" },
  // Google
  "gemini-3.1-pro-preview":  { tier: "powerful",  desc: "Flagship · advanced reasoning" },
  "gemini-3-flash-preview":  { tier: "balanced",  desc: "High-performance · production" },
  "gemini-2.5-pro":          { tier: "powerful",  desc: "Strong reasoning · long context" },
  "gemini-2.5-flash":        { tier: "balanced",  desc: "Fast · multimodal" },
  "gemini-2.5-flash-lite":   { tier: "fast",      desc: "High-volume · lowest cost" },
};

const TIER_COLORS = {
  fast:     { dot: "bg-sky-400",    text: "text-sky-400",    label: "Fast" },
  balanced: { dot: "bg-violet-400", text: "text-violet-400", label: "Balanced" },
  powerful: { dot: "bg-amber-400",  text: "text-amber-400",  label: "Powerful" },
};

function ModelPicker({
  provider, value, onChange,
}: {
  provider: AIProvider;
  value: string;
  onChange: (v: string) => void;
}) {
  const models = AI_MODELS[provider].models;

  return (
    <div>
      <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2 block">
        Model
      </label>

      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger
          className="w-full h-auto py-2.5 px-3 bg-white/[0.04] border-white/[0.07] hover:bg-white/[0.07] hover:border-white/[0.14] rounded-none transition-all text-sm focus-visible:ring-0 focus-visible:border-white/20"
        >
          <SelectValue>
            {(() => {
              const meta = MODEL_META[value];
              const tier = meta ? TIER_COLORS[meta.tier] : null;
              const label = models.find((m) => m.value === value)?.label ?? value;
              return (
                <span className="flex items-center justify-between w-full pr-2">
                  <span className="font-medium text-foreground">{label}</span>
                  {tier && (
                    <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${tier.text}`}>
                      <span className={`size-1.5 rounded-full ${tier.dot}`} />
                      {tier.label}
                    </span>
                  )}
                </span>
              );

            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className="rounded-none border-white/[0.09] bg-[#0d1117] shadow-2xl shadow-black/60 p-1"
          sideOffset={4}
          align="start"
        >
          {models.map((m) => {
            const meta = MODEL_META[m.value];
            const tier = meta ? TIER_COLORS[meta.tier] : null;
            return (
              <SelectItem
                key={m.value}
                value={m.value}
                className="rounded-none px-3 py-2.5 cursor-pointer focus:bg-white/[0.06] data-highlighted:bg-white/[0.06]"
              >
                <span className="flex items-center justify-between w-full">
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-medium leading-tight text-foreground">{m.label}</span>
                    {meta && (
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{meta.desc}</span>
                    )}
                  </span>
                  {tier && (
                    <span className={`flex items-center gap-1.5 text-[10px] font-semibold ml-4 ${tier.text}`}>
                      <span className={`size-1.5 rounded-full ${tier.dot}`} />
                      {tier.label}
                    </span>
                  )}
                </span>

              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}


function BYOKSection() {
  const { data: saved, isLoading } = useAISettings();
  const { mutate: save, isPending: saving } = useSaveAISettings();

  const [provider, setProvider] = useState<AIProvider>("openai");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Sync provider/model from saved config when loaded
  const syncedRef = useState(false);
  if (saved?.configured && !syncedRef[0] && saved.provider) {
    syncedRef[1](true);
    setProvider(saved.provider as AIProvider);
    if (saved.model) setModel(saved.model);
  }

  function handleProviderChange(p: AIProvider) {
    setProvider(p);
    setModel(AI_MODELS[p].models[0].value);
  }

  function handleSave() {
    if (!apiKey.trim() && !saved?.configured) { toast.error("API key is required"); return; }
    save({ provider, model, apiKey: apiKey.trim() }, { onSuccess: () => setApiKey("") });
  }


  if (isLoading) {
    return <div className="border border-white/[0.07] h-20 animate-pulse" />;
  }

  return (
    <div className="border border-white/[0.07] overflow-hidden">
      {/* Status banner */}
      {saved?.configured && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[#4ade80]/[0.04] border-b border-[#4ade80]/10">
          <CheckCircle2 size={13} className="text-[#4ade80] shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <span className="text-[#4ade80] font-semibold">Active</span>
            <span className="text-muted-foreground ml-2">
              {AI_MODELS[saved.provider as AIProvider]?.label} · {AI_MODELS[saved.provider as AIProvider]?.models.find(m => m.value === saved.model)?.label ?? saved.model}
            </span>

          </div>
          <button type="button" onClick={() => save({ clear: true })} disabled={saving}
            className="text-xs text-muted-foreground hover:text-[#f87171] transition-colors">
            Remove
          </button>
        </div>
      )}

      <div className="px-4 py-4 space-y-4">
        {/* Provider pills */}
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2 block">Provider</label>

          <div className="flex gap-1.5">
            {(Object.keys(AI_MODELS) as AIProvider[]).map((p) => (
              <button key={p} type="button" onClick={() => handleProviderChange(p)}
                className={`px-3.5 py-1.5 text-xs font-medium transition-all ${
                  provider === p
                    ? "bg-foreground text-background"
                    : "bg-white/[0.05] border border-white/[0.06] text-muted-foreground hover:bg-white/[0.09] hover:text-foreground"
                }`}>
                {AI_MODELS[p].label}
              </button>
            ))}
          </div>
        </div>

        {/* Model — premium popover picker */}
        <ModelPicker
          provider={provider}
          value={model}
          onChange={(newModel) => {
            setModel(newModel);
            if (saved?.configured && provider === saved.provider) {
              save({ provider, model: newModel, apiKey: "" });
            }
          }}
        />


        {/* API Key */}
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <label
              htmlFor="byok-api-key"
              className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
            >
              {AI_MODELS[provider].label} API Key
            </label>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="How your API key is stored"
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Info size={12} aria-hidden />
                  </button>
                }
              />
              <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                Stored in an httpOnly cookie on this device only. It is not readable from page scripts and is only sent to the server over HTTPS when you save or run AI features.
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                id="byok-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={saved?.configured ? "Enter new key to replace…" : `Your ${AI_MODELS[provider].label} API key`}
                className="font-mono text-xs pr-9 bg-white/[0.04] border-white/[0.07]"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <button type="button" onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <Button size="sm" onClick={handleSave} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <BrainCircuit size={12} className="mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Code snippet ──────────────────────────────────────────────────────────────

export function CodeSnippet({ code, lang = "yaml", filename }: { code: string; lang?: string; filename?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="border border-white/[0.07] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.05]">
        <span className="text-[11px] font-mono text-muted-foreground">{filename ?? lang}</span>
        <button type="button"
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success("Copied"); }}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-colors">
          {copied ? <Check size={11} className="text-[#4ade80]" /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-[#080c10] p-4 text-[12px] font-mono leading-6 overflow-x-auto text-[#c9d1d9] whitespace-pre">{code}</pre>
    </div>
  );
}
