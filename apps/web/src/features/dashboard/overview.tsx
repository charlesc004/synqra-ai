"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  CircleHelp,
  FileText,
  FolderClosed,
  Layers3,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/providers/workspace";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
} from "@/components/shared";
import { useProviderStatus } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
type Dashboard = {
  documents: number;
  collections: number;
  conversations: number;
  open_actions: number;
  statuses: Record<string, number>;
  recent_documents: {
    id: string;
    filename: string;
    status: string;
    created_at: string;
  }[];
};
const questions = [
  {
    icon: BookOpen,
    category: "UNDERSTAND",
    text: "What is our remote-work policy?",
  },
  {
    icon: ShieldCheck,
    category: "INVESTIGATE",
    text: "How do we respond to a security incident?",
  },
  {
    icon: Layers3,
    category: "CONNECT",
    text: "Where is support escalation documented?",
  },
];
export function Overview() {
  const { workspace, user, canWrite, admin } = useWorkspace();
  const stats = useQuery({
    queryKey: ["dashboard", workspace?.id],
    queryFn: () => api<Dashboard>("/dashboard", {}, workspace?.id),
    enabled: !!workspace,
  });
  const provider = useProviderStatus(workspace?.id);
  const hour = new Date().getHours(),
    greeting =
      hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title={`${greeting}, ${user?.name.split(" ")[0] || "there"}.`}
        description="A little less searching. A lot more knowing."
      >
        {canWrite && (
          <Button asChild variant="secondary">
            <Link href="/knowledge?upload=true">
              <Plus size={16} /> Add knowledge
            </Link>
          </Button>
        )}
      </PageHeader>
      <section className="overview-hero">
        <div className="hero-copy">
          <div className="hero-pill">
            <span /> BUILT AROUND YOUR KNOWLEDGE
          </div>
          <h2>
            Turn what you know
            <br />
            into your <em>next big idea.</em>
          </h2>
          <p>
            Ask better questions. Find connected insights.
            <br />
            Move forward with answers you can trust.
          </p>
          <Button asChild>
            <Link href="/chat">
              <Sparkles size={16} /> Start a conversation{" "}
              <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
        <div className="hero-symbol" aria-hidden="true">
          <AudioLines />
        </div>
      </section>
      {stats.error ? (
        <ErrorState error={stats.error} retry={() => void stats.refetch()} />
      ) : stats.isPending ? (
        <LoadingSkeleton />
      ) : (
        <div className="stats-grid">
          {[
            {
              icon: FileText,
              label: "Knowledge documents",
              value: stats.data.documents,
              note: `${stats.data.statuses.ready || 0} indexed and searchable`,
              color: "violet",
            },
            {
              icon: FolderClosed,
              label: "Collections",
              value: stats.data.collections,
              note: "Your knowledge, organized",
              color: "blue",
            },
            {
              icon: MessageSquare,
              label: "Conversations",
              value: stats.data.conversations,
              note: "Ideas with context",
              color: "green",
            },
            {
              icon: Workflow,
              label: "Open action items",
              value: stats.data.open_actions,
              note: "From insight to next step",
              color: "amber",
            },
          ].map((s) => (
            <div className="stat-card" key={s.label}>
              <div>
                <span>{s.label}</span>
                <div className={`stat-icon ${s.color}`}>
                  <s.icon size={18} />
                </div>
              </div>
              <strong>{s.value.toString().padStart(2, "0")}</strong>
              <small>{s.note}</small>
            </div>
          ))}
        </div>
      )}
      <div className="section-heading">
        <div>
          <h2>A good place to start</h2>
          <p className="muted">Let your knowledge do the talking.</p>
        </div>
        <Link href="/chat" className="text-link">
          Explore AI Chat <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="question-grid">
        {questions.map((q) => (
          <Link
            key={q.text}
            href={`/chat?question=${encodeURIComponent(q.text)}`}
            className="question-card"
          >
            <div className="question-top">
              <q.icon size={19} />
              <span>{q.category}</span>
            </div>
            <h3>{q.text}</h3>
            <ArrowRight className="question-arrow" size={18} />
          </Link>
        ))}
      </div>
      <div className="overview-bottom">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Recently added knowledge</h2>
              <p className="muted">The latest pieces of your bigger picture.</p>
            </div>
            <Link className="text-link" href="/knowledge">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {stats.data?.recent_documents.length ? (
            <div className="recent-list">
              {stats.data.recent_documents.map((d) => (
                <Link key={d.id} href={`/knowledge?document=${d.id}`}>
                  <span className="file-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <strong>{d.filename}</strong>
                    <small>Added {formatDate(d.created_at)}</small>
                  </div>
                  <StatusBadge status={d.status} />
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Your next insight starts here"
              description="Upload a document to begin building your connected knowledge."
            >
              {canWrite && (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/knowledge">
                    <ArrowDownToLine size={14} /> Add your first document
                  </Link>
                </Button>
              )}
            </EmptyState>
          )}
        </section>
        <section className="panel workspace-health">
          <div className="panel-heading">
            <h2>Workspace readiness</h2>
            <CircleHelp size={16} />
          </div>
          <p className="muted">A strong foundation for better answers.</p>
          <div className="readiness-item">
            <span className="readiness-icon green">
              <Check size={14} />
            </span>
            <div>
              <strong>Private workspace</strong>
              <small>Access controlled by membership</small>
            </div>
            <span className="status-dot online" />
          </div>
          <div className="readiness-item">
            <span className="readiness-icon violet">
              <BookOpen size={14} />
            </span>
            <div>
              <strong>Knowledge indexing</strong>
              <small>
                {stats.data?.statuses.ready || 0} documents ready to retrieve
              </small>
            </div>
          </div>
          <div className="readiness-item">
            <span className="readiness-icon blue">
              <Sparkles size={14} />
            </span>
            <div>
              <strong>AI connection</strong>
              <small>
                {provider.data?.chat === "connected"
                  ? provider.data.model
                  : "Connect a provider to enable AI"}
              </small>
            </div>
          </div>
          {admin && (
            <Link href="/settings" className="readiness-link">
              Manage workspace <ArrowUpRight size={14} />
            </Link>
          )}
        </section>
      </div>
    </>
  );
}
