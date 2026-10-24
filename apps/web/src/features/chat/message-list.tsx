"use client";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { AudioLines, UserRound } from "lucide-react";
import { SourceCitation } from "@/features/knowledge/source-preview";
import type { Message, Source } from "@/lib/types";
export const ChatMessage = memo(function ChatMessage({
  message,
  onSource,
}: {
  message: Message;
  onSource: (s: Source) => void;
}) {
  return (
    <article className={`chat-message message-${message.role}`}>
      <span className="message-avatar">
        {message.role === "assistant" ? (
          <AudioLines size={18} />
        ) : (
          <UserRound size={18} />
        )}
      </span>
      <div className="message-body">
        <strong>
          {message.role === "assistant" ? "SYNQRA" : "You"}
          {message.role === "assistant" && <span className="ai-label">AI</span>}
        </strong>
        <div className="markdown">
          <ReactMarkdown
            components={{
              a: ({ children }) => <span>{children}</span>,
              img: () => null,
            }}
          >
            {message.content ||
              (message.status === "streaming"
                ? "Searching your knowledge…"
                : "No answer was generated.")}
          </ReactMarkdown>
        </div>
        {message.citations.length > 0 && (
          <div className="message-sources">
            <span className="eyebrow">CONNECTED SOURCES</span>
            <div>
              {message.citations.map((s) => (
                <SourceCitation key={s.id} source={s} onOpen={onSource} />
              ))}
            </div>
          </div>
        )}
        {message.status !== "complete" && (
          <span
            className={`message-state ${message.status === "streaming" ? "" : "field-error"}`}
          >
            {message.status === "streaming"
              ? "Generating · answer is provisional"
              : `${message.status} · partial answer, not verified`}
          </span>
        )}
      </div>
    </article>
  );
});
export function MessageList({
  messages,
  onSource,
}: {
  messages: Message[];
  onSource: (s: Source) => void;
}) {
  return (
    <div className="message-list" aria-live="polite">
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} onSource={onSource} />
      ))}
    </div>
  );
}
