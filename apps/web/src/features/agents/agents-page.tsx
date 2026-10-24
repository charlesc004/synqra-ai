"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CirclePause,
  FileSearch,
  GitCompareArrows,
  ListChecks,
  Loader2,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api, json } from "@/lib/api/client";
import type { AgentRun, Page, Source } from "@/lib/types";
import { useProviderStatus } from "@/lib/queries";
import { useWorkspace } from "@/providers/workspace";
import { useDocuments } from "@/features/knowledge/api";
import {
  DocumentPreview,
  SourceCitation,
} from "@/features/knowledge/source-preview";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  StatusBadge,
  LoadingSkeleton,
  Pagination,
} from "@/components/shared";
const workflows = [
  {
    id: "answer",
    icon: Search,
    name: "Research your knowledge",
    description: "A focused answer with connected sources.",
  },
  {
    id: "summarize",
    icon: FileSearch,
    name: "Find the bigger picture",
    description: "Turn a long document into a clear summary.",
  },
  {
    id: "compare",
    icon: GitCompareArrows,
    name: "Compare documents",
    description: "Understand changes, similarities, and conflicts.",
  },
  {
    id: "extract",
    icon: ListChecks,
    name: "Extract key information",
    description: "Dates, obligations, and action items, structured.",
  },
  {
    id: "action",
    icon: CheckCheck,
    name: "Turn insight into action",
    description: "Propose a follow-up. You approve the next step.",
  },
];
export function ApprovalDialog({
  run,
  busy,
  onDecision,
  onClose,
}: {
  run: AgentRun | null;
  busy: boolean;
  onDecision: (approve: boolean) => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  return (
    <AppDialog
      open={!!run}
      onOpenChange={onClose}
      title="You’re in control of the next step"
      description="Review the exact action before it is added to your workspace."
    >
      <div className="approval-context">
        <ShieldCheck size={18} />
        <div>
          <strong>Create action item</strong>
          <small>{workspace?.name}</small>
        </div>
        <StatusBadge status="awaiting_approval" />
      </div>
      <div className="proposal-fields">
        <span>Title</span>
        <h3>{run?.approval?.proposal.title}</h3>
        <span>Description</span>
        <p>{run?.approval?.proposal.description}</p>
        <span>Due date</span>
        <p>{run?.approval?.proposal.due_date || "No due date"}</p>
        <span>Source document IDs</span>
        <p className="mono">{run?.approval?.proposal.sources.join(", ")}</p>
      </div>
      <p className="fine-print">
        Approval records your identity and decision. The action can execute only
        once, even if you retry.
      </p>
      <div className="dialog-footer">
        <Button
          disabled={busy}
          variant="secondary"
          onClick={() => onDecision(false)}
        >
          <X size={15} /> Reject
        </Button>
        <Button disabled={busy} onClick={() => onDecision(true)}>
          {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{" "}
          Approve action
        </Button>
      </div>
    </AppDialog>
  );
}
export function AgentsPage() {
  const { workspace, canWrite } = useWorkspace(),
    cache = useQueryClient(),
    documents = useDocuments();
  const [workflow, setWorkflow] = useState("answer"),
    [question, setQuestion] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(1),
    [active, setActive] = useState<AgentRun | null>(null),
    [approval, setApproval] = useState<AgentRun | null>(null),
    [source, setSource] = useState<Source | null>(null);
  const runs = useQuery({
    queryKey: ["runs", workspace?.id, page],
    queryFn: () =>
      api<Page<AgentRun>>(`/agents/runs?page=${page}`, {}, workspace?.id),
    enabled: !!workspace,
  });
  const provider = useProviderStatus(workspace?.id);
  const execute = useMutation({
    mutationFn: () =>
      api<AgentRun>(
        "/agents/runs",
        {
          method: "POST",
          ...json({ workflow, question, document_ids: selected }),
        },
        workspace?.id,
      ),
    onSuccess: async (run) => {
      setActive(run);
      await cache.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      api<AgentRun>(
        `/agents/runs/${approval?.id}/${approved ? "approve" : "reject"}`,
        { method: "POST" },
        workspace?.id,
      ),
    onSuccess: async (run) => {
      setActive(run);
      setApproval(null);
      await cache.invalidateQueries({ queryKey: ["runs"] });
      await cache.invalidateQueries({ queryKey: ["actions"] });
      await cache.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const needsStructured = ["compare", "extract", "action"].includes(workflow);
  const available =
    provider.data?.chat === "connected" &&
    (!needsStructured || provider.data.structured);
  return (
    <>
      <PageHeader
        eyebrow="FROM INFORMATION TO MOMENTUM"
        title="Agent Workspace"
        description="Purposeful workflows. Connected evidence. Every action under your control."
      >
        <span className="security-pill">
          <ShieldCheck size={14} /> Human approval for every AI write
        </span>
      </PageHeader>
      <div className="agents-grid">
        <section className="panel workflow-picker">
          <div className="panel-heading">
            <h2>Choose a workflow</h2>
            <Sparkles size={17} />
          </div>
          {workflows
            .filter((w) => canWrite || w.id !== "action")
            .map((w) => (
              <button
                key={w.id}
                onClick={() => setWorkflow(w.id)}
                className={`workflow-option ${workflow === w.id ? "selected" : ""}`}
              >
                <span>
                  <w.icon size={19} />
                </span>
                <div>
                  <strong>{w.name}</strong>
                  <small>{w.description}</small>
                </div>
                <ChevronRight size={15} />
              </button>
            ))}
        </section>
        <section className="panel run-composer">
          <div className="panel-heading">
            <h2>{workflows.find((w) => w.id === workflow)?.name}</h2>
            <span className="badge">Controlled workflow</span>
          </div>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              execute.mutate();
            }}
          >
            <label>
              What would you like to accomplish?
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  workflow === "action"
                    ? "Propose a follow-up task to review our security policy…"
                    : "Describe the question or outcome you have in mind…"
                }
              />
            </label>
            <fieldset>
              <legend>
                Source documents{" "}
                <span className="muted">
                  {workflow === "compare"
                    ? "Select 2–4 documents"
                    : "Optional for research; required for summaries and extraction"}
                </span>
              </legend>
              <div className="document-checkboxes">
                {documents.data?.items
                  .filter((d) => d.status === "ready")
                  .map((d) => (
                    <label key={d.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(d.id)}
                        disabled={
                          !selected.includes(d.id) && selected.length >= 4
                        }
                        onChange={(e) =>
                          setSelected((previous) =>
                            e.target.checked
                              ? [...previous, d.id]
                              : previous.filter((id) => id !== d.id),
                          )
                        }
                      />
                      <span>{d.filename}</span>
                    </label>
                  ))}
                {!documents.data?.items.some((d) => d.status === "ready") && (
                  <p className="muted">
                    Indexed documents will appear here. Upload knowledge to get
                    started.
                  </p>
                )}
              </div>
            </fieldset>
            {!available && (
              <div className="setup-notice">
                <CirclePause size={16} />
                {needsStructured
                  ? "A connected model with verified structured output support is required."
                  : "Connect a chat model before running a workflow."}
              </div>
            )}
            {execute.error && <ErrorState error={execute.error} />}
            <Button
              disabled={execute.isPending || !available || !question.trim()}
            >
              {execute.isPending ? (
                <>
                  <Loader2 className="spin" size={16} /> Working with your
                  knowledge…
                </>
              ) : (
                <>
                  <Play size={15} /> Run workflow <ArrowRight size={15} />
                </>
              )}
            </Button>
          </form>
        </section>
      </div>
      <div className="section-heading">
        <div>
          <h2>Workflow activity</h2>
          <p className="muted">
            A clear record of what happened and what comes next.
          </p>
        </div>
      </div>
      {runs.isPending ? (
        <LoadingSkeleton />
      ) : runs.error ? (
        <ErrorState error={runs.error} />
      ) : runs.data?.items.length ? (
        <div className="run-history">
          {runs.data.items.map((run) => (
            <button
              className="run-history-item"
              key={run.id}
              onClick={() => setActive(run)}
            >
              <span className="file-icon">
                <Sparkles size={18} />
              </span>
              <div>
                <strong>{run.request.question}</strong>
                <small>
                  {workflows.find((w) => w.id === run.workflow)?.name}
                </small>
              </div>
              <StatusBadge status={run.status} />
              <ChevronRight size={15} />
            </button>
          ))}
          <Pagination
            page={page}
            hasMore={runs.data.has_more}
            onChange={setPage}
          />
        </div>
      ) : (
        <EmptyState
          title="Your first workflow is a question away"
          description="Choose a workflow to turn connected knowledge into something useful."
        />
      )}
      {active && (
        <section className="panel run-detail">
          <div className="panel-heading">
            <h2>Workflow result</h2>
            <StatusBadge status={active.status} />
          </div>
          <div className="agent-steps">
            {active.events.map((event, index) => (
              <div key={index} className="tool-call-card">
                <span
                  className={`step-circle ${event.status === "completed" ? "step-complete" : ""}`}
                >
                  {event.status === "completed" ? (
                    <Check size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <strong>{event.tool.replaceAll("_", " ")}</strong>
                <small>
                  {event.status}
                  {event.duration_ms > 0 && ` · ${event.duration_ms} ms`}
                </small>
              </div>
            ))}
          </div>
          {active.error && <ErrorState error={active.error} />}
          <div className="workflow-result">
            {Object.entries(active.result)
              .filter(([key]) => key !== "citations")
              .map(([key, value]) => (
                <div key={key}>
                  <span className="eyebrow">{key.replaceAll("_", " ")}</span>
                  {Array.isArray(value) ? (
                    <ul>
                      {value.map((item, index) => (
                        <li key={index}>
                          {typeof item === "string"
                            ? item
                            : JSON.stringify(item)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {typeof value === "string"
                        ? value
                        : JSON.stringify(value, null, 2)}
                    </p>
                  )}
                </div>
              ))}
          </div>
          {active.result.citations && (
            <div className="source-grid">
              {active.result.citations.map((s) => (
                <SourceCitation key={s.id} source={s} onOpen={setSource} />
              ))}
            </div>
          )}
          {active.approval && active.status === "awaiting_approval" && (
            <div className="approval-banner">
              <div>
                <CirclePause size={20} />
                <strong>Your approval is the next step</strong>
              </div>
              <Button onClick={() => setApproval(active)}>
                Review proposed action <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </section>
      )}
      {decide.error && <ErrorState error={decide.error} />}
      <ApprovalDialog
        run={approval}
        onClose={() => setApproval(null)}
        busy={decide.isPending}
        onDecision={(value) => decide.mutate(value)}
      />
      <DocumentPreview
        documentId={source?.document_id || null}
        source={source}
        onClose={() => setSource(null)}
      />
    </>
  );
}
