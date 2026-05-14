"use client";

import { useState } from "react";
import { GitBranch, ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

interface SignInCardProps {
  githubConfigured: boolean;
}

export default function SignInCard({ githubConfigured }: SignInCardProps) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="w-full max-w-sm fade-up">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8">
        <div className="flex size-7 items-center justify-center rounded bg-foreground text-background font-mono text-[11px] font-semibold">
          EF
        </div>
        <span className="text-sm font-semibold">ExecForge</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight mb-1">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Connect your GitHub account to continue.
        </p>
      </div>

      {/* GitHub button */}
      <Button
        type="button"
        disabled={loading || !githubConfigured}
        onClick={async () => {
          if (!githubConfigured) return;
          setError("");
          setLoading(true);
          try {
            await authClient.signIn.social({ provider: "github", callbackURL: "/api/auth/post-login" });
          } catch {
            setError("GitHub sign-in failed. Check your OAuth app credentials.");
            setLoading(false);
          }
        }}
        className="flex w-full items-center justify-center gap-2.5 bg-foreground text-background hover:opacity-90 disabled:opacity-40 px-4 py-2.5 text-sm font-medium rounded-md"
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <GitBranch size={15} strokeWidth={1.5} />}
        {loading ? "Redirecting…" : "Continue with GitHub"}
        {!loading && githubConfigured && <ArrowRight size={14} className="ml-auto" />}
      </Button>

      {/* Error */}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Not configured warning */}
      {!githubConfigured && (
        <div className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Missing <code className="font-mono">GITHUB_CLIENT_ID</code> or{" "}
          <code className="font-mono">GITHUB_CLIENT_SECRET</code> in environment.
        </div>
      )}
    </div>
  );
}
