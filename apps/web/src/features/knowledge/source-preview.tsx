"use client";
import { useQuery } from "@tanstack/react-query";
import { FileText, ArrowUpRight } from "lucide-react";
import { AppDialog } from "@/components/ui/dialog";
import { ErrorState, LoadingSkeleton, StatusBadge } from "@/components/shared";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/providers/workspace";
import type { DocumentRecord, Source } from "@/lib/types";
export function SourceCitation({
  source,
  onOpen,
}: {
  source: Source;
  onOpen: (source: Source) => void;
}) {
  return (
    <button className="source-citation" onClick={() => onOpen(source)}>
      <span>{source.label || source.rank || <FileText size={13} />}</span>
      <div>
        <strong>{source.filename}</strong>
        <small>
          {source.page
            ? `Page ${source.page}`
            : source.section || "Source excerpt"}
        </small>
      </div>
      <ArrowUpRight size={14} />
    </button>
  );
}
export function DocumentPreview({
  documentId,
  source,
  onClose,
}: {
  documentId: string | null;
  source?: Source | null;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const query = useQuery({
    queryKey: ["preview", workspace?.id, documentId],
    queryFn: () =>
      api<{ document: DocumentRecord; text: string; chunks: Source[] }>(
        `/documents/${documentId}/preview`,
        {},
        workspace?.id,
      ),
    enabled: !!documentId && !!workspace,
  });
  return (
    <AppDialog
      open={!!documentId}
      onOpenChange={onClose}
      title={query.data?.document.filename || "Document preview"}
      description="Extracted text and source provenance"
      wide
    >
      {query.isPending ? (
        <LoadingSkeleton />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        query.data && (
          <>
            <div className="preview-meta">
              <StatusBadge status={query.data.document.status} />
              <span>{query.data.document.chunk_count} chunks</span>
              <span>Version {query.data.document.version}</span>
            </div>
            {source && (
              <div className="source-highlight">
                <div className="eyebrow">
                  CITED EXCERPT {source.page ? `· PAGE ${source.page}` : ""}
                </div>
                <p>{source.text}</p>
              </div>
            )}
            <div className="preview-text">
              {query.data.chunks.length > 0 ? (
                query.data.chunks.map((c) => (
                  <section
                    key={c.id}
                    className={source?.id === c.id ? "selected-chunk" : ""}
                  >
                    <div className="eyebrow">
                      {c.page ? `PAGE ${c.page} · ` : ""}
                      {c.section || "EXCERPT"}
                    </div>
                    <p>{c.text}</p>
                  </section>
                ))
              ) : (
                <p>
                  {query.data.text ||
                    "Text extraction is pending. Processing status will update after the worker runs."}
                </p>
              )}
            </div>
          </>
        )
      )}
    </AppDialog>
  );
}
