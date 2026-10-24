"use client";
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  AudioLines,
  BookOpen,
  ChevronDown,
  Plus,
  ShieldCheck,
  Square,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace";
import { useProviderStatus } from "@/lib/queries";
import type { Source } from "@/lib/types";
import { useCollections } from "@/features/knowledge/api";
import { DocumentPreview } from "@/features/knowledge/source-preview";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingSkeleton } from "@/components/shared";
import { MessageList } from "./message-list";
import { useChat } from "./use-chat";
import { ConversationControls } from "./conversation-controls";
const suggestions = [
  "What is our remote-work policy?",
  "Summarize our incident response process.",
  "Where is customer support escalation documented?",
  "What are our project delivery milestones?",
];
function ChatSession({
  initialId,
  initialQuestion,
}: {
  initialId: string | null;
  initialQuestion: string;
}) {
  const { workspace } = useWorkspace(),
    collections = useCollections();
  const [collection, setCollection] = useState(""),
    [question, setQuestion] = useState(initialQuestion),
    [source, setSource] = useState<Source | null>(null);
  const chat = useChat(initialId, collection);
  const openSource = useCallback((s: Source) => setSource(s), []);
  const provider = useProviderStatus(workspace?.id);
  const available =
    provider.data?.chat === "connected" &&
    provider.data.embeddings === "connected";
  async function send() {
    if (!question.trim()) return;
    const value = question;
    setQuestion("");
    await chat.send(value);
  }
  return (
    <div
      className={`chat-layout ${!chat.messages.length ? "chat-layout-empty" : ""}`}
    >
      <div className="chat-top">
        <div>
          <AudioLines size={19} />
          <strong>{chat.title || "AI Chat"}</strong>
          <span className="badge">Grounded in your knowledge</span>
        </div>
        <div>
          {chat.conversationId && !chat.busy && (
            <ConversationControls
              id={chat.conversationId}
              title={chat.title || "Conversation"}
            />
          )}
          <Button variant="secondary" size="sm" asChild>
            <a href="/chat">
              <Plus size={14} /> New chat
            </a>
          </Button>
        </div>
      </div>
      <div className="chat-scroll">
        {chat.pending && <LoadingSkeleton />}
        {chat.messages.length ? (
          <MessageList messages={chat.messages} onSource={openSource} />
        ) : (
          <div className="chat-welcome">
            <div className="chat-welcome-mark">
              <AudioLines size={34} />
            </div>
            <h1>Where will your curiosity take you?</h1>
            <p>Answers and ideas, grounded in your team’s knowledge.</p>
          </div>
        )}
      </div>
      <div className="chat-compose-wrap">
        {!available && provider.data && (
          <div className="setup-notice">
            <ShieldCheck size={16} />
            <span>
              AI is awaiting configuration. Connect chat and embedding models in
              the server environment.
            </span>
          </div>
        )}
        {chat.error && <ErrorState error={chat.error} />}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            rows={2}
            maxLength={4000}
            aria-label="Message SYNQRA"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question. Connect an idea. Find your next step…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!chat.busy && available) void send();
              }
            }}
          />
          <div className="composer-bottom">
            <label>
              <BookOpen size={14} />
              <select
                aria-label="Knowledge scope"
                disabled={!!chat.conversationId || chat.busy}
                value={chat.collectionId}
                onChange={(e) => setCollection(e.target.value)}
              >
                <option value="">All knowledge</option>
                {collections.data?.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <span className="model-label">
              <span className={`status-dot ${available ? "online" : ""}`} />
              {provider.data?.model || "No model connected"}
            </span>
            {chat.busy ? (
              <Button
                size="icon"
                aria-label="Stop generation"
                onClick={chat.stop}
                type="button"
              >
                <Square size={15} />
              </Button>
            ) : (
              <Button
                size="icon"
                type="submit"
                aria-label="Send message"
                disabled={!question.trim() || !available}
              >
                <ArrowUp size={18} />
              </Button>
            )}
          </div>
        </form>
        <p className="composer-note">
          <ShieldCheck size={12} /> Answers are grounded in your documents.
          Review sources for important decisions.
        </p>
        {!chat.messages.length && !chat.pending && (
          <div className="chat-suggestions">
            {suggestions.map((suggestion) => (
              <button
                onClick={() => setQuestion(suggestion)}
                key={suggestion}
                type="button"
              >
                <strong>{suggestion}</strong>
                <Sparkles size={15} />
              </button>
            ))}
          </div>
        )}
      </div>
      <DocumentPreview
        documentId={source?.document_id || null}
        source={source}
        onClose={() => setSource(null)}
      />
    </div>
  );
}
export function ChatPage() {
  const params = useSearchParams(),
    { workspace } = useWorkspace();
  return (
    <ChatSession
      key={`${workspace?.id}:${params.get("id")}`}
      initialId={params.get("id")}
      initialQuestion={params.get("question") || ""}
    />
  );
}
