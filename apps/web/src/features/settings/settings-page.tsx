"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CirclePause,
  KeyRound,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { api, json } from "@/lib/api/client";
import type { Page, Workspace } from "@/lib/types";
import { useProviderStatus } from "@/lib/queries";
import { useWorkspace } from "@/providers/workspace";
import {
  AppDataTable,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
type Member = { id: string; name: string; email: string; role: string };
export function SettingsPage() {
  const { workspace, admin, selectWorkspace } = useWorkspace(),
    cache = useQueryClient();
  const [name, setName] = useState<string | null>(null),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("member"),
    [tab, setTab] = useState("general"),
    [newOpen, setNewOpen] = useState(false),
    [newName, setNewName] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [notice, setNotice] = useState("");
  const provider = useProviderStatus(workspace?.id);
  const members = useQuery({
    queryKey: ["members", workspace?.id],
    queryFn: () =>
      api<Member[]>(`/workspaces/${workspace?.id}/members`, {}, workspace?.id),
    enabled: !!workspace && admin,
  });
  const audit = useQuery({
    queryKey: ["audit", workspace?.id],
    queryFn: () =>
      api<
        Page<{
          id: string;
          operation: string;
          created_at: string;
          actor_id: string;
        }>
      >("/audit", {}, workspace?.id),
    enabled: !!workspace && admin && tab === "security",
  });
  const update = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) =>
      api<Partial<Workspace>>(path, { method, ...json(body) }, workspace?.id),
    onSuccess: async (data) => {
      await cache.invalidateQueries({ queryKey: ["workspaces"] });
      await cache.invalidateQueries({ queryKey: ["members"] });
      if (newOpen && data.id) selectWorkspace(data.id);
      setNewOpen(false);
      setEmail("");
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Changes saved successfully.");
    },
  });
  if (!admin)
    return (
      <ErrorState error="Only workspace owners and administrators can manage settings." />
    );
  return (
    <>
      <PageHeader
        eyebrow="A WORKSPACE THAT WORKS FOR YOU"
        title="Workspace Settings"
        description="Manage your team, your connections, and how knowledge flows."
      >
        <Button variant="secondary" onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New workspace
        </Button>
      </PageHeader>
      <div className="settings-tabs">
        {["general", "members", "models", "security"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t === "models"
              ? "AI & Models"
              : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {update.error && <ErrorState error={update.error} />}{" "}
      {notice && (
        <div className="success-notice" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}
      {tab === "general" && (
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace details</h2>
              <p className="muted">
                A shared space for your team’s collective intelligence.
              </p>
            </div>
            <Settings2 size={19} />
          </div>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({
                path: `/workspaces/${workspace?.id}`,
                method: "PATCH",
                body: { name: name ?? workspace?.name },
              });
            }}
          >
            <label>
              Workspace name
              <input
                required
                maxLength={120}
                value={name ?? workspace?.name ?? ""}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Your role
              <input readOnly value={workspace?.role || ""} />
            </label>
            <Button disabled={update.isPending}>Save workspace</Button>
          </form>
        </section>
      )}
      {tab === "members" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>The people behind your knowledge</h2>
              <p className="muted">
                Add registered users by email and assign workspace access.
              </p>
            </div>
          </div>
          <form
            className="member-form"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({
                path: `/workspaces/${workspace?.id}/members`,
                body: { email, role },
              });
            }}
          >
            <input
              type="email"
              aria-label="Member email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
            <select
              value={role}
              aria-label="Role"
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              {workspace?.role === "owner" && (
                <option value="admin">Admin</option>
              )}
            </select>
            <Button disabled={update.isPending}>Add or update member</Button>
          </form>
          {members.isPending ? (
            <LoadingSkeleton />
          ) : members.error ? (
            <ErrorState error={members.error} />
          ) : (
            <AppDataTable headings={["Name", "Email", "Role"]}>
              {members.data?.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                  </td>
                  <td className="muted">{m.email}</td>
                  <td>
                    <span className="badge">{m.role}</span>
                  </td>
                </tr>
              ))}
            </AppDataTable>
          )}
        </section>
      )}
      {tab === "models" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Your intelligence connection</h2>
                <p className="muted">
                  Provider configuration and credentials stay on the server.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void provider.refetch()}
                disabled={provider.isFetching}
              >
                <RefreshCw size={14} /> Check connection
              </Button>
            </div>
            {provider.error ? (
              <ErrorState error={provider.error} />
            ) : provider.isPending ? (
              <LoadingSkeleton />
            ) : (
              <div className="provider-grid">
                {[
                  {
                    label: "Chat model",
                    model: provider.data.model,
                    status: provider.data.chat,
                  },
                  {
                    label: "Embedding model",
                    model: provider.data.embedding_model,
                    status: provider.data.embeddings,
                  },
                ].map((p) => (
                  <div className="provider-card" key={p.label}>
                    {p.status === "connected" ? (
                      <CheckCircle2 size={21} />
                    ) : (
                      <CirclePause size={21} />
                    )}
                    <span className="eyebrow">{p.label}</span>
                    <h3>{p.model || "No model configured"}</h3>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel setup-guide">
            <KeyRound size={24} />
            <div>
              <h3>Connect once. Build on what you know.</h3>
              <p>
                Set AI_PROVIDER, CHAT_MODEL, EMBEDDING_PROVIDER,
                EMBEDDING_MODEL, and EMBEDDING_DIMENSION in the server’s .env
                file. Add OPENAI_API_KEY for OpenAI, or set the trusted
                OLLAMA_BASE_URL for local models.
              </p>
              <p>
                Verify model capabilities before enabling
                MODEL_SUPPORTS_STRUCTURED or MODEL_SUPPORTS_TOOLS. Restart the
                API and worker after changing configuration. Reindex collections
                when the embedding model changes. Dimension changes require a
                database migration and reindexing.
              </p>
              <p className="fine-print">
                Connected means the provider reports the model is present.
                Generation and embeddings are validated on use.
              </p>
            </div>
          </section>
        </>
      )}
      {tab === "security" && (
        <>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <h2>Account security</h2>
                <p className="muted">
                  Changing your password revokes existing sessions.
                </p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({
                  path: "/auth/password",
                  body: {
                    current_password: currentPassword,
                    new_password: newPassword,
                  },
                });
              }}
            >
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <Button disabled={update.isPending}>Update password</Button>
            </form>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Recent audit activity</h2>
              <span className="badge">Last 30 events</span>
            </div>
            {audit.error ? (
              <ErrorState error={audit.error} />
            ) : (
              <AppDataTable headings={["Operation", "Actor", "Timestamp"]}>
                {audit.data?.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.operation}</td>
                    <td className="mono muted">{e.actor_id.slice(0, 8)}</td>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </AppDataTable>
            )}
          </section>
        </>
      )}
      <AppDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Create a new workspace"
        description="A separate space with its own membership and knowledge."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ path: "/workspaces", body: { name: newName } });
          }}
        >
          <label>
            Workspace name
            <input
              required
              maxLength={120}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <Button disabled={update.isPending}>Create workspace</Button>
        </form>
      </AppDialog>
    </>
  );
}
