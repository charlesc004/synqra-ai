"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Clock3,
  FlaskConical,
  Play,
  Plus,
  Target,
} from "lucide-react";
import { api, json } from "@/lib/api/client";
import type { Evaluation, Page, Source } from "@/lib/types";
import { useWorkspace } from "@/providers/workspace";
import { useDocuments } from "@/features/knowledge/api";
import { DocumentPreview } from "@/features/knowledge/source-preview";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import {
  AppDataTable,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  Pagination,
  StatusBadge,
} from "@/components/shared";
import { formatDate } from "@/lib/utils";
const UsageChart = dynamic(() => import("./usage-chart"), {
  ssr: false,
  loading: () => <LoadingSkeleton />,
});
type EvalCase = { question: string; relevant_document_ids: string[] };
export function EvaluationsPage() {
  const { workspace, admin } = useWorkspace(),
    cache = useQueryClient(),
    documents = useDocuments();
  const [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [name, setName] = useState("Knowledge benchmark"),
    [question, setQuestion] = useState(""),
    [expected, setExpected] = useState<string[]>([]),
    [cases, setCases] = useState<EvalCase[]>([]),
    [k, setK] = useState(6),
    [mode, setMode] = useState("hybrid"),
    [activeId, setActiveId] = useState<string | null>(null),
    [source, setSource] = useState<Source | null>(null);
  const runs = useQuery({
    queryKey: ["evaluations", workspace?.id, page],
    queryFn: () =>
      api<Page<Evaluation>>(`/evaluations?page=${page}`, {}, workspace?.id),
    enabled: !!workspace && admin,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => ["queued", "running"].includes(r.status))
        ? 3000
        : false,
  });
  const active = useQuery({
    queryKey: ["evaluation", workspace?.id, activeId],
    queryFn: () =>
      api<Evaluation>(`/evaluations/runs/${activeId}`, {}, workspace?.id),
    enabled: !!activeId && admin,
  });
  const usage = useQuery({
    queryKey: ["usage", workspace?.id],
    queryFn: () =>
      api<{
        days: { date: string; requests: number; latency_ms: number }[];
        tokens: number | null;
        provider: string;
        model: string | null;
      }>("/usage/summary", {}, workspace?.id),
    enabled: !!workspace && admin,
  });
  const run = useMutation({
    mutationFn: () =>
      api<Evaluation>(
        "/evaluations/runs",
        { method: "POST", ...json({ name, k, mode, cases }) },
        workspace?.id,
      ),
    onSuccess: async () => {
      setOpen(false);
      await cache.invalidateQueries({ queryKey: ["evaluations"] });
    },
  });
  const loadDemo = useMutation({
    mutationFn: () =>
      api<{ name: string; cases: EvalCase[]; missing_filenames: string[] }>(
        "/evaluations/dataset",
        {},
        workspace?.id,
      ),
    onSuccess: (dataset) => {
      setName(dataset.name);
      setCases(dataset.cases);
    },
  });
  const latest = runs.data?.items.find((r) => r.status === "completed");
  const number = (value: number | null | undefined, percent = false) =>
    value == null
      ? "—"
      : percent
        ? `${(value * 100).toFixed(1)}%`
        : value.toFixed(0);
  if (!admin)
    return (
      <ErrorState error="Only workspace owners and administrators can inspect evaluations." />
    );
  return (
    <>
      <PageHeader
        eyebrow="QUALITY YOU CAN INSPECT"
        title="Evaluations & Insights"
        description="Understand what your retrieval finds, what it misses, and where to improve."
      >
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> New evaluation
        </Button>
      </PageHeader>
      <div className="stats-grid evaluation-stats">
        {[
          {
            icon: Target,
            label: "Recall@K",
            value: number(latest?.metrics.recall_at_k, true),
            note: "Expected documents retrieved",
          },
          {
            icon: BarChart3,
            label: "Precision@K",
            value: number(latest?.metrics.precision_at_k, true),
            note: "Relevant documents in K slots",
          },
          {
            icon: FlaskConical,
            label: "Mean reciprocal rank",
            value: latest?.metrics.mrr?.toFixed(3) || "—",
            note: "First relevant document rank",
          },
          {
            icon: Clock3,
            label: "Retrieval latency",
            value:
              latest?.metrics.latency_ms == null
                ? "—"
                : `${number(latest.metrics.latency_ms)} ms`,
            note: "Measured across benchmark cases",
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={18} />
            </div>
            <strong>{s.value}</strong>
            <small>{latest ? s.note : "Run a benchmark to measure"}</small>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Intelligence in motion</h2>
            <p className="muted">
              Recorded AI requests over the last 30 active days.
            </p>
          </div>
          <span className="badge">
            {usage.data?.tokens == null
              ? "Token usage unavailable"
              : `${usage.data.tokens.toLocaleString()} measured tokens`}
          </span>
        </div>
        {usage.error ? (
          <ErrorState error={usage.error} />
        ) : usage.data?.days.length ? (
          <UsageChart days={usage.data.days} />
        ) : (
          <EmptyState
            title="Your activity will tell a story"
            description="AI requests and measured latency appear here after you use a connected model."
          />
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>Evaluation runs</h2>
          <p className="muted">
            Persisted results from your actual retrieval pipeline.
          </p>
        </div>
      </div>
      {runs.isPending ? (
        <LoadingSkeleton />
      ) : runs.error ? (
        <ErrorState error={runs.error} />
      ) : runs.data?.items.length ? (
        <div className="panel">
          <AppDataTable
            headings={[
              "Benchmark",
              "Mode",
              "Status",
              "Recall@K",
              "Created",
              "",
            ]}
          >
            {runs.data.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.configuration.name}</strong>
                  <small className="table-subtext">
                    K = {r.configuration.k}
                  </small>
                </td>
                <td>{r.configuration.mode}</td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.error && <p className="table-error">{r.error}</p>}
                </td>
                <td>{number(r.metrics.recall_at_k, true)}</td>
                <td>{formatDate(r.created_at)}</td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActiveId(r.id);
                      void cache.invalidateQueries({
                        queryKey: ["evaluation"],
                      });
                    }}
                  >
                    Inspect results
                  </Button>
                </td>
              </tr>
            ))}
          </AppDataTable>
          <Pagination
            page={page}
            hasMore={runs.data.has_more}
            onChange={setPage}
          />
        </div>
      ) : (
        <EmptyState
          title="Better answers begin with better measurement"
          description="Define questions and their relevant documents, then test the same retrieval used by chat."
        />
      )}
      {activeId && (
        <section className="panel evaluation-detail">
          <div className="panel-heading">
            <h2>Case-by-case results</h2>
            <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>
              Close
            </Button>
          </div>
          {active.isPending ? (
            <LoadingSkeleton />
          ) : active.error ? (
            <ErrorState error={active.error} />
          ) : (
            active.data?.results.map((r, i) => (
              <article key={i}>
                <h3>{r.question}</h3>
                <div className="case-metrics">
                  {r.unanswerable ? (
                    <span>
                      Unanswerable case ·{" "}
                      {r.empty_retrieval
                        ? "No candidates found"
                        : "Candidates need manual review"}
                    </span>
                  ) : (
                    <>
                      <span>Recall {number(r.recall_at_k, true)}</span>
                      <span>Precision {number(r.precision_at_k, true)}</span>
                      <span>MRR {r.mrr.toFixed(2)}</span>
                    </>
                  )}
                  <span>{number(r.latency_ms)} ms</span>
                </div>
                <div className="source-grid">
                  {r.excerpts.map((s) => (
                    <Button
                      variant="secondary"
                      size="sm"
                      key={s.id}
                      onClick={() => setSource(s)}
                    >
                      {s.filename}
                    </Button>
                  ))}
                </div>
              </article>
            ))
          )}
        </section>
      )}
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        title="Measure your knowledge retrieval"
        description="Use known questions and expected documents. Empty expectations represent unanswerable cases."
        wide
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <div className="form-row">
            <label>
              Benchmark name
              <input
                required
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Results (K)
              <input
                type="number"
                min={1}
                max={20}
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
              />
            </label>
            <label>
              Retrieval mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="hybrid">Hybrid</option>
                <option value="semantic">Semantic</option>
                <option value="keyword">Keyword</option>
              </select>
            </label>
          </div>
          <Button
            variant="secondary"
            type="button"
            disabled={loadDemo.isPending}
            onClick={() => loadDemo.mutate()}
          >
            Load Northstar benchmark
          </Button>
          {loadDemo.error && <ErrorState error={loadDemo.error} />}
          {!!loadDemo.data?.missing_filenames.length && (
            <p className="fine-print">
              Some Northstar documents are missing. Only cases with accessible
              source documents were loaded. Seed the full corpus to run the
              complete benchmark.
            </p>
          )}
          <label>
            Question
            <input
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is our remote-work policy?"
            />
          </label>
          <fieldset>
            <legend>Expected relevant documents</legend>
            <div className="document-checkboxes">
              {documents.data?.items.map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    checked={expected.includes(d.id)}
                    onChange={(e) =>
                      setExpected((previous) =>
                        e.target.checked
                          ? [...previous, d.id]
                          : previous.filter((id) => id !== d.id),
                      )
                    }
                  />
                  {d.filename}
                </label>
              ))}
            </div>
          </fieldset>
          <Button
            variant="secondary"
            type="button"
            disabled={!question.trim()}
            onClick={() => {
              setCases((previous) => [
                ...previous,
                { question, relevant_document_ids: expected },
              ]);
              setQuestion("");
              setExpected([]);
            }}
          >
            Add question ({cases.length} added)
          </Button>
          {cases.map((c, i) => (
            <div key={i} className="benchmark-case">
              <span>
                {c.question} · {c.relevant_document_ids.length} expected
                documents
              </span>
              <button
                type="button"
                aria-label={`Remove question ${i + 1}`}
                onClick={() =>
                  setCases((previous) =>
                    previous.filter((_, index) => index !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {run.error && <ErrorState error={run.error} />}
          <Button disabled={run.isPending || !cases.length}>
            <Play size={15} /> Run evaluation
          </Button>
        </form>
      </AppDialog>
      <DocumentPreview
        documentId={source?.document_id || null}
        source={source}
        onClose={() => setSource(null)}
      />
      <p className="fine-print">
        Metrics measure document retrieval, not factual correctness. Citation
        existence is checked separately during generation. No model-judge score
        is presented as proof.
      </p>
    </>
  );
}
