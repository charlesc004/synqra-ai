"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Circle,
  CircleDashed,
  Plus,
  SquareCheckBig,
} from "lucide-react";
import { api, json } from "@/lib/api/client";
import type { ActionItem, Page } from "@/lib/types";
import { useWorkspace } from "@/providers/workspace";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  Pagination,
} from "@/components/shared";
import { formatDate } from "@/lib/utils";
const columns = [
  { id: "open", label: "To do", icon: Circle },
  { id: "in_progress", label: "In progress", icon: CircleDashed },
  { id: "done", label: "Completed", icon: SquareCheckBig },
];
export function ActionsPage() {
  const { workspace, canWrite, user, admin } = useWorkspace(),
    cache = useQueryClient();
  const [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [dueDate, setDueDate] = useState("");
  const actions = useQuery({
    queryKey: ["actions", workspace?.id, page],
    queryFn: () =>
      api<Page<ActionItem>>(`/actions?page=${page}`, {}, workspace?.id),
    enabled: !!workspace,
  });
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id?: string; status?: string }) =>
      api(
        id ? `/actions/${id}` : "/actions",
        {
          method: id ? "PATCH" : "POST",
          ...json(
            id ? { status } : { title, description, due_date: dueDate || null },
          ),
        },
        workspace?.id,
      ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["actions"] });
      await cache.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueDate("");
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="GOOD IDEAS DESERVE A NEXT STEP"
        title="Action Items"
        description="Keep the momentum. Track the work that comes from what you learn."
      >
        {canWrite && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Create action item
          </Button>
        )}
      </PageHeader>
      {mutation.error && <ErrorState error={mutation.error} />}
      <div className="action-summary">
        <span className="summary-icon">
          <SquareCheckBig size={20} />
        </span>
        <div>
          <strong>Insight, meet follow-through.</strong>
          <p>AI-proposed actions appear here only after you approve them.</p>
        </div>
        <a href="/agents" className="text-link">
          Explore workflows <ArrowRight size={15} />
        </a>
      </div>
      {actions.isPending ? (
        <LoadingSkeleton />
      ) : actions.error ? (
        <ErrorState error={actions.error} />
      ) : (
        <>
          <div className="kanban">
            {columns.map((column) => (
              <section
                key={column.id}
                className={`kanban-column kanban-${column.id}`}
              >
                <div className="kanban-heading">
                  <column.icon size={16} />
                  <h2>{column.label}</h2>
                  <span>
                    {actions.data?.items.filter((a) => a.status === column.id)
                      .length || 0}
                  </span>
                </div>
                {actions.data?.items
                  .filter((a) => a.status === column.id)
                  .map((action) => (
                    <article key={action.id} className="action-card">
                      <div className="eyebrow">WORKSPACE ACTION</div>
                      <h3>{action.title}</h3>
                      <p>{action.description}</p>
                      <div className="action-card-meta">
                        <small>
                          {action.due_date
                            ? `Due ${formatDate(action.due_date)}`
                            : "No due date"}
                        </small>
                        {action.sources.length > 0 && (
                          <span>{action.sources.length} sources</span>
                        )}
                      </div>
                      {canWrite &&
                        (action.created_by === user?.id ||
                          action.assignee_id === user?.id ||
                          admin) && (
                          <select
                            aria-label={`Status for ${action.title}`}
                            disabled={mutation.isPending}
                            value={action.status}
                            onChange={(e) =>
                              mutation.mutate({
                                id: action.id,
                                status: e.target.value,
                              })
                            }
                          >
                            {columns.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}
                    </article>
                  ))}
                {!actions.data?.items.some((a) => a.status === column.id) && (
                  <div className="kanban-empty">
                    <Check size={20} />
                    <p>
                      {column.id === "done"
                        ? "Completed work lands here."
                        : "A little room for what’s next."}
                    </p>
                  </div>
                )}
              </section>
            ))}
          </div>
          <Pagination
            page={page}
            hasMore={actions.data?.has_more || false}
            onChange={setPage}
          />
          {!actions.data?.items.length && (
            <EmptyState
              title="A clear path ahead"
              description="Create your own action or ask an agent to propose one from your knowledge."
            />
          )}
        </>
      )}
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        title="Give your next step a name"
        description="This is an explicit human-created action; AI proposals require separate approval."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({});
          }}
        >
          <label>
            Title
            <input
              required
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Review the incident response playbook"
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A little context goes a long way…"
            />
          </label>
          <label>
            Due date <span className="muted">optional</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          {mutation.error && <ErrorState error={mutation.error} />}
          <Button disabled={mutation.isPending || !title.trim()}>
            Create action item
          </Button>
        </form>
      </AppDialog>
    </>
  );
}
