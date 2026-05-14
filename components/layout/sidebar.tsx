"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard,
  GitCommitHorizontal,
  FlaskConical,
  GitPullRequest,
  Webhook,
  Settings,
  LogOut,
  ChevronsUpDown,
  Search,
  GitBranch,
  Check,
  BookOpen,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

interface RepoSummary {
  id: string;
  name: string;
  fullName: string;
}

interface AppSidebarProps {
  userName: string;
  userEmail: string;
  userImage?: string | null;
  orgName?: string;
  repos?: RepoSummary[];
}

const NAV_MAIN = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/runs", label: "Runs", icon: GitCommitHorizontal },
  { href: "/dashboard/tests", label: "Tests", icon: FlaskConical },
  { href: "/dashboard/pr-agent", label: "PR Agent", icon: GitPullRequest },
];

const NAV_SYSTEM = [
  { href: "/dashboard/examples", label: "Examples", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

// ─── Repo picker dropdown ──────────────────────────────────────────────────────

function RepoPicker({
  repos,
  activeRepo,
  onSelect,
}: {
  repos: RepoSummary[];
  activeRepo: RepoSummary | undefined;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)
    );
  }, [repos, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        panelRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (repos.length === 0) return null;

  return (
    <div className="relative group-data-[collapsible=icon]:hidden">
      {/* Trigger — same visual style as the original org selector */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate font-mono">
            {activeRepo ? activeRepo.name : "Select repository"}
          </span>
        </div>
        <ChevronsUpDown size={12} className="shrink-0 opacity-50" />
      </button>

      {/* Dropdown panel — floats above the sidebar content */}
      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[200px] rounded-lg border border-sidebar-border bg-popover shadow-xl shadow-black/30 overflow-hidden"
          style={{ maxHeight: 280 }}
        >
          {/* Search input */}
          {repos.length > 5 && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search size={11} className="shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repos…"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none font-mono"
              />
            </div>
          )}

          {/* Repo list */}
          <div className="scroll-thin overflow-y-auto overflow-x-hidden" style={{ maxHeight: repos.length > 5 ? 220 : 260 }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No repos found</p>
            ) : (
              filtered.map((repo) => {
                const active = repo.id === activeRepo?.id;
                return (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => {
                      onSelect(repo.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent ${
                      active ? "text-sidebar-foreground" : "text-sidebar-foreground/70"
                    }`}
                  >
                    <div
                      className={`size-1.5 rounded-full shrink-0 transition-colors ${
                        active ? "bg-[#4ade80]" : "bg-sidebar-foreground/20"
                      }`}
                    />
                    <span className="flex-1 truncate text-xs font-mono">{repo.name}</span>
                    {active && <Check size={11} className="shrink-0 text-[#4ade80]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main sidebar ──────────────────────────────────────────────────────────────

export function AppSidebar({ userName, userEmail, userImage, orgName, repos = [] }: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // Derive active repo id from URL, but fall back to first repo only as default.
  // We use a local state so selections survive client-side navigations.
  const paramRepoId = searchParams.get("repo");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(
    paramRepoId ?? repos[0]?.id ?? null,
  );

  // Keep local state in sync if the URL param changes (e.g. user navigates via
  // browser history or a link that already carries ?repo=).
  useEffect(() => {
    if (paramRepoId && paramRepoId !== selectedRepoId) {
      setSelectedRepoId(paramRepoId);
    }
  }, [paramRepoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRepoId = selectedRepoId ?? repos[0]?.id ?? null;
  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? repos[0];

  // Build an href that preserves the active ?repo= param across navigations.
  const repoHref = useCallback(
    (base: string) => {
      if (!activeRepoId) return base;
      const params = new URLSearchParams(searchParams.toString());
      params.set("repo", activeRepoId);
      return `${base}?${params.toString()}`;
    },
    [activeRepoId, searchParams],
  );

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  function selectRepo(id: string) {
    setSelectedRepoId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("repo", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push("/");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      {/* Brand + repo selector */}
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        {/* Logo row */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded bg-sidebar-foreground text-sidebar font-mono text-[10px] font-semibold">
            EF
          </div>
          <span className="text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            ExecForge
          </span>
        </div>

        {/* Repo picker — mimics the original org selector button */}
        {repos.length > 0 ? (
          <RepoPicker repos={repos} activeRepo={activeRepo} onSelect={selectRepo} />
        ) : orgName ? (
          /* Fallback: show org name as static label when no repos yet */
          <div className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
            <GitBranch size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate font-mono">{orgName}</span>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {/* Main nav */}
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_MAIN.map(({ href, label, icon: Icon, exact }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    isActive={isActive(href, exact)}
                    tooltip={label}
                    className="text-sidebar-foreground/70 data-[active=true]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent"
                    render={<Link href={repoHref(href)} />}
                  >
                    <Icon size={15} strokeWidth={1.5} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* System group */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/40 font-mono uppercase tracking-widest px-2">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_SYSTEM.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    isActive={isActive(href)}
                    tooltip={label}
                    className="text-sidebar-foreground/70 data-[active=true]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent"
                    render={<Link href={repoHref(href)} />}
                  >
                    <Icon size={15} strokeWidth={1.5} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* User row */}
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2.5 px-1.5 py-1 rounded-md group-data-[collapsible=icon]:justify-center">
              <Avatar className="size-7 shrink-0">
                {userImage ? <AvatarImage src={userImage} alt={userName} /> : null}
                <AvatarFallback className="text-[10px] bg-sidebar-accent text-sidebar-foreground">
                  {userName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-1 min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                <span className="truncate text-xs font-medium text-sidebar-foreground">{userName}</span>
                <span className="truncate text-[11px] text-sidebar-foreground/50">{userEmail}</span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out"
                className="shrink-0 rounded p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:hidden"
              >
                <LogOut size={13} strokeWidth={1.5} />
              </button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
