"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/providers/workspace";
import type { Collection, DocumentRecord, Page } from "@/lib/types";
export function useCollections() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["collections", workspace?.id],
    queryFn: () => api<Collection[]>("/collections", {}, workspace?.id),
    enabled: !!workspace,
  });
}
export function useDocuments(page = 1, collection = "", query = "") {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: ["documents", workspace?.id, page, collection, query],
    queryFn: () =>
      api<Page<DocumentRecord>>(
        `/documents?page=${page}&collection_id=${collection}&q=${encodeURIComponent(query)}`,
        {},
        workspace?.id,
      ),
    enabled: !!workspace,
    refetchInterval: (q) =>
      q.state.data?.items.some((d) =>
        ["queued", "processing", "retrying"].includes(d.status),
      )
        ? 3000
        : false,
  });
}
