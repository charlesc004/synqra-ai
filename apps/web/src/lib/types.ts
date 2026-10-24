export type User = { id: string; name: string; email: string };
export type Workspace = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
};
export type Collection = {
  id: string;
  name: string;
  description: string;
  embedding_identity: string;
  index_version: number;
};
export type DocumentRecord = {
  id: string;
  filename: string;
  collection_id: string;
  file_type: string;
  size: number;
  status: string;
  error: string | null;
  chunk_count: number;
  created_at: string;
  visibility: string;
  version: number;
  embedding_identity: string | null;
};
export type Source = {
  id: string;
  document_id: string;
  filename: string;
  text: string;
  page: number | null;
  section: string | null;
  label?: string;
  score?: number;
  rank?: number;
};
export type Conversation = {
  id: string;
  title: string;
  collection_id: string | null;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  citations: Source[];
};
export type ActionItem = {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "done";
  due_date: string | null;
  sources: string[];
  created_by: string;
  assignee_id: string | null;
  created_at: string;
};
export type Page<T> = { items: T[]; has_more: boolean; page?: number };
export type ProviderStatus = {
  test_mode?: boolean;
  provider: string;
  model: string | null;
  chat: string;
  embeddings: string;
  embedding_model: string | null;
  dimension: number;
  structured: boolean;
  tools: boolean;
};
export type AgentRun = {
  id: string;
  workflow: string;
  status: string;
  request: { question: string };
  result: Record<string, unknown> & { citations?: Source[]; answer?: string };
  events: { tool: string; status: string; duration_ms: number; at: string }[];
  error: string | null;
  created_at: string;
  approval: {
    id: string;
    status: string;
    proposal: {
      title: string;
      description: string;
      sources: string[];
      due_date?: string | null;
    };
  } | null;
};
export type Evaluation = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  configuration: {
    name: string;
    k: number;
    mode: string;
    embedding_identity: string;
  };
  metrics: Record<string, number | null>;
  results: {
    question: string;
    precision_at_k: number;
    recall_at_k: number;
    mrr: number;
    latency_ms: number;
    unanswerable: boolean;
    empty_retrieval: boolean;
    excerpts: Source[];
  }[];
};
