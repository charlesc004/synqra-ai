"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  FolderPlus,
  Layers3,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace";
import { useCollections, useDocuments } from "@/features/knowledge/api";
import { api, json } from "@/lib/api/client";
import type { DocumentRecord, Source } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import {
  AppDataTable,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge,
} from "@/components/shared";
import { fileSize, formatDate } from "@/lib/utils";
import { FileUpload } from "./file-upload";
import { DocumentPreview, SourceCitation } from "./source-preview";
export function KnowledgePage() {
  const params = useSearchParams(),
    { workspace, canWrite, admin } = useWorkspace(),
    cache = useQueryClient();
  const [collection, setCollection] = useState(""),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [upload, setUpload] = useState(params.has("upload")),
    [newCollection, setNewCollection] = useState(false),
    [name, setName] = useState("");
  const [preview, setPreview] = useState<string | null>(params.get("document")),
    [source, setSource] = useState<Source | null>(null),
    [deleting, setDeleting] = useState<DocumentRecord | null>(null);
  const [mode, setMode] = useState(params.has("search") ? "search" : "files"),
    [searchMode, setSearchMode] = useState("hybrid"),
    [results, setResults] = useState<Source[] | null>(null);
  const collections = useCollections(),
    documents = useDocuments(page, collection, query);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const operation = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => api(path, { method, ...(body ? json(body) : {}) }, workspace?.id),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["documents"] });
      await cache.invalidateQueries({ queryKey: ["collections"] });
      await cache.invalidateQueries({ queryKey: ["dashboard"] });
      setDeleting(null);
      setNewCollection(false);
      setName("");
    },
  });
  const searching = useMutation({
    mutationFn: () =>
      api<{ items: Source[] }>(
        "/knowledge/search",
        {
          method: "POST",
          ...json({
            query: search,
            collection_id: collection || null,
            mode: searchMode,
          }),
        },
        workspace?.id,
      ),
    onSuccess: (data) => setResults(data.items),
  });
  function openSource(s: Source) {
    setSource(s);
    setPreview(s.document_id);
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR SINGLE SOURCE OF CONTEXT"
        title="Knowledge Base"
        description="Everything your team knows. Ready to connect the dots."
      >
        {canWrite && (
          <>
            <Button variant="secondary" onClick={() => setNewCollection(true)}>
              <FolderPlus size={16} /> New collection
            </Button>
            <Button
              onClick={() => setUpload(true)}
              disabled={!collections.data?.length}
            >
              <Plus size={16} /> Upload documents
            </Button>
          </>
        )}
      </PageHeader>
      {collections.error && <ErrorState error={collections.error} />}
      <div className="collection-strip">
        <button
          className={`collection-card ${!collection ? "selected" : ""}`}
          onClick={() => {
            setCollection("");
            setPage(1);
            setResults(null);
          }}
        >
          <span className="collection-icon">
            <Layers3 size={21} />
          </span>
          <strong>All knowledge</strong>
          <small>Your connected workspace</small>
        </button>
        {collections.data?.map((c) => (
          <button
            key={c.id}
            className={`collection-card ${collection === c.id ? "selected" : ""}`}
            onClick={() => {
              setCollection(c.id);
              setPage(1);
              setResults(null);
            }}
          >
            <span className="collection-icon">
              <FolderPlus size={21} />
            </span>
            <strong>{c.name}</strong>
            <small>{c.description || `Index version ${c.index_version}`}</small>
          </button>
        ))}
      </div>
      <div className="panel knowledge-panel">
        <div className="knowledge-toolbar">
          <div className="segmented">
            <button
              className={mode === "files" ? "selected" : ""}
              onClick={() => setMode("files")}
            >
              <FileText size={15} /> Documents
            </button>
            <button
              className={mode === "search" ? "selected" : ""}
              onClick={() => setMode("search")}
            >
              <Search size={15} /> Knowledge search
            </button>
          </div>
          {admin && collection && (
            <Button
              variant="ghost"
              size="sm"
              disabled={operation.isPending}
              onClick={() =>
                operation.mutate({ path: `/collections/${collection}/reindex` })
              }
            >
              <RefreshCw size={14} /> Reindex collection
            </Button>
          )}
        </div>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "search" && search.trim()) searching.mutate();
          }}
        >
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={
              mode === "files"
                ? "Find a document by name…"
                : "Ask your knowledge a question…"
            }
          />
          {mode === "search" && (
            <>
              <select
                aria-label="Retrieval mode"
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value)}
              >
                <option value="hybrid">Hybrid search</option>
                <option value="semantic">Semantic search</option>
                <option value="keyword">Keyword search</option>
              </select>
              <Button disabled={!search.trim() || searching.isPending}>
                {searching.isPending ? "Searching…" : "Search knowledge"}
              </Button>
            </>
          )}
        </form>
        {(operation.error || searching.error) && (
          <ErrorState error={operation.error || searching.error} />
        )}
        {mode === "files" ? (
          documents.isPending ? (
            <LoadingSkeleton />
          ) : documents.error ? (
            <ErrorState
              error={documents.error}
              retry={() => void documents.refetch()}
            />
          ) : documents.data?.items.length ? (
            <>
              <AppDataTable
                headings={["Document", "Collection", "Status", "Added", ""]}
              >
                {documents.data.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <button
                        className="document-name"
                        onClick={() => {
                          setPreview(d.id);
                          setSource(null);
                        }}
                      >
                        <span className="file-icon">
                          <FileText size={20} />
                        </span>
                        <span>
                          <strong>
                            {d.filename}
                            {d.visibility === "private" && (
                              <LockKeyhole size={12} />
                            )}
                          </strong>
                          <small>
                            {d.file_type.slice(1).toUpperCase()} ·{" "}
                            {fileSize(d.size)} · {d.chunk_count} chunks · v
                            {d.version}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="collection-label">
                        {
                          collections.data?.find(
                            (c) => c.id === d.collection_id,
                          )?.name
                        }
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                      {d.error && <div className="table-error">{d.error}</div>}
                    </td>
                    <td className="muted">{formatDate(d.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        {canWrite &&
                          ["failed", "awaiting_configuration"].includes(
                            d.status,
                          ) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Retry ${d.filename}`}
                              disabled={operation.isPending}
                              onClick={() =>
                                operation.mutate({
                                  path: `/documents/${d.id}/retry`,
                                })
                              }
                            >
                              <RefreshCw size={15} />
                            </Button>
                          )}
                        {canWrite && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete ${d.filename}`}
                            onClick={() => setDeleting(d)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </AppDataTable>
              <Pagination
                page={page}
                hasMore={documents.data.has_more}
                onChange={setPage}
              />
            </>
          ) : (
            <EmptyState
              title={
                search
                  ? "No matching documents"
                  : "Make your knowledge work for you"
              }
              description={
                search
                  ? "Try a different document name or collection."
                  : "Upload handbooks, policies, and project notes to create a shared source of answers."
              }
            >
              {canWrite && (
                <Button onClick={() => setUpload(true)}>
                  <Upload size={16} /> Upload your first document
                </Button>
              )}
            </EmptyState>
          )
        ) : results === null ? (
          <EmptyState
            title="Find the evidence behind your next idea"
            description="Search real indexed document excerpts using semantic, keyword, or hybrid retrieval."
          />
        ) : results.length ? (
          <div className="search-results">
            {results.map((s) => (
              <article key={s.id}>
                <SourceCitation source={s} onOpen={openSource} />
                <p>{s.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No supporting evidence found"
            description="Try keyword search, broaden your selection, or check that your documents are indexed."
          />
        )}
      </div>
      <div className="knowledge-note">
        <LockKeyhole size={14} /> Documents are scoped to your workspace.
        Private uploads are visible only to their uploader.
      </div>
      <FileUpload
        key={workspace?.id}
        open={upload}
        onClose={() => setUpload(false)}
        collections={collections.data || []}
      />
      <DocumentPreview
        documentId={preview}
        source={source}
        onClose={() => setPreview(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this document?"
        description={`${deleting?.filename || "This document"} and its searchable chunks will be removed.`}
        onConfirm={() =>
          operation.mutate({
            path: `/documents/${deleting?.id}`,
            method: "DELETE",
          })
        }
        busy={operation.isPending}
      />
      <AppDialog
        open={newCollection}
        onOpenChange={setNewCollection}
        title="A home for related knowledge"
        description="Create a collection to keep your team's sources organized."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            operation.mutate({ path: "/collections", body: { name } });
          }}
        >
          <label>
            Collection name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. People & Culture"
            />
          </label>
          {operation.error && <ErrorState error={operation.error} />}
          <Button disabled={operation.isPending || !name.trim()}>
            Create collection
          </Button>
        </form>
      </AppDialog>
    </>
  );
}
