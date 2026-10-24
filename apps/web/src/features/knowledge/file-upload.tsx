"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/providers/workspace";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import type { Collection } from "@/lib/types";
type UploadState = {
  name: string;
  status: "uploading" | "uploaded" | "failed";
  error?: string;
};
export function FileUpload({
  open,
  onClose,
  collections,
}: {
  open: boolean;
  onClose: () => void;
  collections: Collection[];
}) {
  const { workspace } = useWorkspace(),
    cache = useQueryClient(),
    input = useRef<HTMLInputElement>(null);
  const [collection, setCollection] = useState(""),
    [visibility, setVisibility] = useState("workspace"),
    [files, setFiles] = useState<UploadState[]>([]),
    [dragging, setDragging] = useState(false);
  const busy = files.some((f) => f.status === "uploading");
  async function upload(selected: FileList | File[]) {
    const list = Array.from(selected);
    setFiles(list.map((file) => ({ name: file.name, status: "uploading" })));
    for (const [index, file] of list.entries()) {
      try {
        if (!/\.(pdf|docx|txt|md)$/i.test(file.name))
          throw new Error("Use PDF, DOCX, TXT, or Markdown");
        if (file.size > 50 * 1024 * 1024)
          throw new Error(
            "File exceeds 50 MB; the server may enforce a lower limit",
          );
        const body = new FormData();
        body.set("file", file);
        body.set("collection_id", collection || collections[0]?.id || "");
        body.set("visibility", visibility);
        await api("/documents", { method: "POST", body }, workspace?.id);
        setFiles((previous) =>
          previous.map((f, i) =>
            i === index ? { ...f, status: "uploaded" } : f,
          ),
        );
      } catch (e) {
        setFiles((previous) =>
          previous.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Upload failed",
                }
              : f,
          ),
        );
      }
    }
    await cache.invalidateQueries({ queryKey: ["documents"] });
    await cache.invalidateQueries({ queryKey: ["dashboard"] });
  }
  return (
    <AppDialog
      open={open}
      onOpenChange={() => {
        if (!busy) onClose();
      }}
      title="Add to your knowledge"
      description="Upload documents. SYNQRA will extract, chunk, and index their content."
    >
      <div className="form-stack">
        <label>
          Collection
          <select
            disabled={busy}
            value={collection || collections[0]?.id || ""}
            onChange={(e) => setCollection(e.target.value)}
          >
            {collections.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visibility
          <select
            disabled={busy}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="workspace">Everyone in this workspace</option>
            <option value="private">Only me</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !collections.length}
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy && collections.length) void upload(e.dataTransfer.files);
          }}
        >
          <UploadCloud size={30} />
          <strong>Drop your documents here</strong>
          <span>or click to browse files</span>
          <small>PDF, DOCX, TXT, Markdown · server limit applies</small>
        </button>
        <input
          aria-label="Choose documents to upload"
          className="sr-only"
          type="file"
          ref={input}
          multiple
          accept=".pdf,.docx,.txt,.md"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        {files.map((file, i) => (
          <div className="upload-file" key={`${file.name}-${i}`}>
            <FileUp size={17} />
            <div>
              <strong>{file.name}</strong>
              <small>
                {file.error ||
                  (file.status === "uploaded"
                    ? "Uploaded · indexing queued"
                    : file.status)}
              </small>
            </div>
            {file.status === "uploading" ? (
              <Loader2 size={16} className="spin" />
            ) : file.status === "uploaded" ? (
              <CheckCircle2 size={17} className="success-text" />
            ) : (
              <XCircle size={17} className="field-error" />
            )}
          </div>
        ))}
        <p className="fine-print">
          Scanned PDFs need OCR and are not supported. Documents become
          searchable only after embeddings are successfully stored.
        </p>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Done
        </Button>
      </div>
    </AppDialog>
  );
}
