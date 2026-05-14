import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { ArrowRight, GitBranch, Zap, Shield } from "lucide-react";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Nav */}
      <header
        style={{
          height: 48,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          position: "sticky",
          top: 0,
          background: "var(--background)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              background: "var(--foreground)",
              borderRadius: 4,
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: "var(--background)",
            }}
          >
            EF
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>ExecForge</span>
        </div>

        <Link
          href={session ? "/dashboard" : "/sign-in"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 6,
            background: "var(--foreground)",
            color: "var(--background)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {session ? "Dashboard" : "Sign in"}
          <ArrowRight size={14} strokeWidth={1.5} />
        </Link>
      </header>

      {/* Hero */}
      <main
        style={{
          flex: 1,
          maxWidth: 680,
          margin: "0 auto",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
        className="fade-up"
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--color-success)",
            width: "fit-content",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-success)",
            }}
            className="pulse"
          />
          v1.0 · Execution Intelligence Platform
        </span>

        <h1
          style={{
            fontSize: "clamp(28px, 5vw, 44px)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            margin: 0,
            color: "var(--foreground)",
          }}
        >
          Engineering execution
          <br />
          intelligence for CI/CD teams
        </h1>

        <p
          style={{
            fontSize: 15,
            color: "var(--muted-foreground)",
            lineHeight: 1.65,
            margin: 0,
            maxWidth: 500,
          }}
        >
          Ingest GitHub Actions telemetry, surface bottlenecks, detect flaky tests,
          and generate optimization PRs — all in one workspace.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          <Link
            href={session ? "/dashboard" : "/sign-in"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 6,
              background: "var(--foreground)",
              color: "var(--background)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            {session ? "Open dashboard" : "Get started"}
            <ArrowRight size={14} strokeWidth={1.5} />
          </Link>
          <Link
            href="/onboarding"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              background: "transparent",
            }}
          >
            Set up workspace
          </Link>
        </div>

        {/* Feature row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginTop: 48,
            paddingTop: 32,
            borderTop: "1px solid var(--border)",
          }}
        >
          {[
            {
              icon: GitBranch,
              title: "GitHub Native",
              desc: "Reads Actions metadata, webhooks, and runtime telemetry without modifying workflows.",
            },
            {
              icon: Zap,
              title: "Instant Insights",
              desc: "Critical path, cache waste, flaky tests and cost breakdown across all repos.",
            },
            {
              icon: Shield,
              title: "Guardrailed PRs",
              desc: "AI-generated optimization pull requests with risk scoring and rollback safeguards.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Icon size={16} strokeWidth={1.5} style={{ color: "var(--muted-foreground)" }} />
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</p>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.55 }}>{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
