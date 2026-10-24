"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Blocks,
  BookOpen,
  ChevronDown,
  FlaskConical,
  FolderClosed,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SquareCheckBig,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import type { Conversation, Page } from "@/lib/types";
import {
  useCurrentUser,
  useProviderStatus,
  useWorkspaces,
} from "@/lib/queries";
import { useWorkspace } from "@/providers/workspace";
import { ErrorState, LoadingSkeleton } from "@/components/shared";
import { Button } from "@/components/ui/button";
const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/knowledge", label: "Knowledge Base", icon: FolderClosed },
  { href: "/agents", label: "Agents", icon: Blocks },
  { href: "/actions", label: "Action Items", icon: SquareCheckBig },
  { href: "/evaluations", label: "Evaluations", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    cache = useQueryClient();
  const { user, workspace, workspaces, selectWorkspace, admin } =
    useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const me = useCurrentUser();
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape") setMobile(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, [mobile]);
  const conversations = useQuery({
    queryKey: ["conversations", workspace?.id],
    queryFn: () => api<Page<Conversation>>("/conversations", {}, workspace?.id),
    enabled: !!workspace,
  });
  const provider = useProviderStatus(workspace?.id);
  const workspaceQuery = useWorkspaces(user?.id);
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    cache.clear();
    router.replace("/login");
  }
  if (me.isPending)
    return (
      <main className="center-state">
        <LoadingSkeleton />
      </main>
    );
  if (me.error)
    return (
      <main className="center-state">
        <div className="brand dark-brand">
          <AudioLines /> SYNQRA<span>AI</span>
        </div>
        {me.error instanceof ApiError && me.error.status === 401 ? (
          <>
            <h1>Your knowledge, connected.</h1>
            <p className="muted">Sign in to continue to your workspace.</p>
            <Button asChild>
              <Link href="/login">
                Sign in <ArrowUpRight size={16} />
              </Link>
            </Button>
          </>
        ) : (
          <ErrorState error={me.error} retry={() => void me.refetch()} />
        )}
      </main>
    );
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <button
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-expanded={mobile}
        aria-controls="workspace-navigation"
        inert={mobile}
        onClick={() => setMobile(true)}
      >
        <Menu />
      </button>
      {mobile && (
        <div className="sidebar-backdrop" onClick={() => setMobile(false)} />
      )}
      <aside
        ref={sidebar}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile || undefined}
        id="workspace-navigation"
        aria-label="Workspace navigation"
        className={`sidebar ${mobile ? "sidebar-open" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") setMobile(false);
        }}
      >
        <div className="sidebar-top">
          <Link
            href="/dashboard"
            className="brand"
            aria-label="SYNQRA home"
            onClick={() => setMobile(false)}
          >
            <span className="brand-mark">
              <AudioLines size={23} />
            </span>
            <span className="brand-wordmark">
              SYNQRA<span>AI</span>
            </span>
          </Link>
          <button
            className="desktop-collapse icon-button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <a
          href="/chat"
          className="sidebar-new-chat"
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={19} />
          <span>New chat</span>
        </a>
        <Link
          href="/knowledge?search=true"
          className="sidebar-search"
          title="Search knowledge"
          aria-label="Search knowledge"
          onClick={() => setMobile(false)}
        >
          <Search size={18} />
          <span>Search knowledge</span>
        </Link>
        <div className="sidebar-scroll">
          <nav aria-label="Workspace pages">
            {navigation
              .filter(
                (n) => admin || !["/evaluations", "/settings"].includes(n.href),
              )
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={
                    pathname.startsWith(item.href) ? "page" : undefined
                  }
                  onClick={() => setMobile(false)}
                  className={`nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}
                >
                  <item.icon size={19} />
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
          </nav>
          <div className="history-heading">
            <span>Recent chats</span>
            <a
              href="/chat"
              aria-label="New conversation"
              title="New conversation"
            >
              <Plus size={15} />
            </a>
          </div>
          <div className="sidebar-history">
            {conversations.data?.items.slice(0, 8).map((c) => (
              <Link
                key={c.id}
                href={`/chat?id=${c.id}`}
                title={c.title}
                onClick={() => setMobile(false)}
              >
                <span>{c.title}</span>
              </Link>
            ))}
            {conversations.data?.items.length === 0 && (
              <p>Your conversations will appear here.</p>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="workspace-rail-button workspace-avatar"
            title={workspace?.name || "Select workspace"}
            aria-label="Expand workspace selector"
            onClick={() => setCollapsed(false)}
          >
            {workspace?.name.slice(0, 1) || "W"}
          </button>
          <div className="workspace-select">
            <div className="workspace-avatar">
              {workspace?.name.slice(0, 1) || "W"}
            </div>
            <div>
              <span className="tiny">WORKSPACE</span>
              <select
                aria-label="Select workspace"
                value={workspace?.id || ""}
                onChange={(e) => selectWorkspace(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <ChevronDown size={14} />
          </div>
          <div className="model-card">
            <div className="model-icon">
              <ShieldCheck size={17} />
            </div>
            <div>
              <strong>
                {provider.data?.chat === "connected"
                  ? "Model connected"
                  : "Connect your intelligence"}
              </strong>
              <p>
                {provider.data?.model || "Configure a model to get started"}
              </p>
            </div>
            <span
              className={`status-dot ${provider.data?.chat === "connected" ? "online" : ""}`}
            />
          </div>
          <div className="profile">
            <div className="avatar">
              {user?.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="profile-copy">
              <strong>{user?.name}</strong>
              <span>{workspace?.role || "Personal account"}</span>
            </div>
            <button
              className="icon-button"
              onClick={() =>
                void logout().catch((e) => window.alert(e.message))
              }
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main" inert={mobile}>
        {provider.data?.test_mode && (
          <div className="test-mode-banner" role="status">
            Test workspace · AI responses use a controlled test model.
          </div>
        )}
        <div className="topbar">
          <div>
            <BookOpen size={15} />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {navigation.find((n) => pathname.startsWith(n.href))?.label ||
                "Overview"}
            </strong>
          </div>
          <span className="privacy-label">
            <ShieldCheck size={13} /> Private workspace
          </span>
        </div>
        <main className="page-content">
          {workspaceQuery.error ? (
            <ErrorState
              error={workspaceQuery.error}
              retry={() => void workspaceQuery.refetch()}
            />
          ) : !workspace ? (
            <LoadingSkeleton />
          ) : (
            <Fragment key={workspace.id}>{children}</Fragment>
          )}
        </main>
        <footer className="app-footer">
          SYNQRA AI <span>Intelligence connected to your knowledge.</span>
          <span className="footer-right">Evidence first. Always.</span>
        </footer>
      </div>
    </div>
  );
}
