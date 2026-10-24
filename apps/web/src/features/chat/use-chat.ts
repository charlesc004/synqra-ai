"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api/client";
import { streamAnswer } from "@/lib/streaming";
import type { Conversation, Message } from "@/lib/types";
import { useWorkspace } from "@/providers/workspace";
export function useChat(initialId: string | null, collectionId: string) {
  const { workspace } = useWorkspace(),
    cache = useQueryClient();
  const [conversationId, setConversationId] = useState(initialId),
    [live, setLive] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const query = useQuery({
    queryKey: ["conversation", workspace?.id, conversationId],
    queryFn: () =>
      api<Conversation & { messages: Message[] }>(
        `/conversations/${conversationId}`,
        {},
        workspace?.id,
      ),
    enabled: !!conversationId && !!workspace,
  });
  useEffect(() => () => controller.current?.abort(), []);
  const stop = useCallback(() => controller.current?.abort(), []);
  async function send(question: string) {
    if (busy || !workspace) return;
    setBusy(true);
    setError(null);
    let id = conversationId;
    try {
      if (!id) {
        const created = await api<Conversation>(
          "/conversations",
          { method: "POST", ...json({ collection_id: collectionId || null }) },
          workspace.id,
        );
        id = created.id;
        setConversationId(id);
      }
      const generationId = crypto.randomUUID(),
        userMessage: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: question,
          status: "complete",
          citations: [],
        };
      const assistant: Message = {
        id: generationId,
        role: "assistant",
        content: "",
        status: "streaming",
        citations: [],
      };
      setLive([...(query.data?.messages || []), userMessage, assistant]);
      controller.current = new AbortController();
      await streamAnswer(
        id,
        workspace.id,
        question,
        generationId,
        controller.current.signal,
        ({ event, data }) => {
          if (event === "token_delta")
            setLive((previous) =>
              previous.map((m) =>
                m.id === generationId
                  ? { ...m, content: m.content + data.delta }
                  : m,
              ),
            );
          if (event === "generation_completed")
            setLive((previous) =>
              previous.map((m) =>
                m.id === generationId
                  ? {
                      ...m,
                      status: "complete",
                      citations: data.citations || [],
                    }
                  : m,
              ),
            );
        },
      );
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      setError(
        aborted
          ? "Generation stopped. Any partial answer is unverified."
          : e instanceof Error
            ? e.message
            : "Generation failed",
      );
      setLive((previous) =>
        previous.map((m) =>
          m.status === "streaming"
            ? { ...m, status: aborted ? "interrupted" : "failed" }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      controller.current = null;
      await cache.invalidateQueries({ queryKey: ["conversations"] });
      await cache.invalidateQueries({
        queryKey: ["conversation", workspace.id, id],
      });
    }
  }
  return {
    conversationId,
    collectionId: query.data?.collection_id ?? collectionId,
    messages: live.length ? live : query.data?.messages || [],
    busy,
    error: error || query.error?.message,
    pending: query.isFetching && !live.length,
    send,
    stop,
    title: query.data?.title,
  };
}
