# Document ingestion and grounded answers

## Ingestion

Upload → validate bytes/type → private file storage → document row → RQ job → extract structured text → section/page-aware token chunks → real embeddings → atomic replacement of chunks/vectors → Ready.

Supported formats are extractable PDF, DOCX paragraphs/headings, UTF-8 TXT, and Markdown headings. Scanned/blank or encrypted PDFs receive explicit errors; OCR is absent. DOCX table extraction is currently absent. PDF page metadata is retained. Markdown sections are kept separate. Chunk offsets are section-relative tokenizer positions, not PDF coordinates or character offsets.

Chunking uses cl100k_base token accounting, configurable 500-token targets with 80-token overlap, and paragraph/sentence boundaries near each target. Duplicate text within the same section/page is suppressed. This tokenizer is a budgeting approximation for Ollama models with different tokenizers. Provider context limits must be configured appropriately; no automatic model-context discovery is claimed.

An embedding response must contain one finite, nonzero vector per input with the exact configured dimension. Identity combines provider, model, and dimension. Collections and chunks store that identity plus an index version. Chat and embeddings can use different providers. A missing embedding provider leaves extracted documents awaiting configuration. No document becomes Ready before its full vector representation commits.

Worker row locks serialize replacement against deletion and retries. Processing state is committed before parsing; replacement rows commit together. A retry deletes the prior chunk set only inside the successful replacement transaction. Deletion tombstones the document and removes chunks before deleting its private file, so concurrent jobs cannot recreate searchable deleted content. A retry policy uses three delayed attempts. While an RQ retry remains scheduled, the document is marked `retrying` and the frontend keeps polling; only terminal failure enables manual retry. A real transient-embedding failure/retry-to-ready path is covered by Playwright. Large parsing and embedding work stays off the upload request.

Reindex increments collection index version and requeues documents. Old incompatible vectors are immediately excluded. This implementation intentionally has indexing downtime during reindex rather than a blue/green index switch. Dimension changes require a migration and HNSW rebuild. There is no automatic destructive schema change.

## Shared retrieval

Chat, knowledge search, and graph tools all call `retrieve`. SQL conditions enforce actor workspace, document visibility, Ready status, collection/model identity, and current index version. Optional collection/document selections further restrict the query.

Semantic candidates use pgvector cosine distance with a configurable candidate count and a conservative fixed distance cutoff of 0.65. Keyword candidates use `websearch_to_tsquery`, `tsvector`, and `ts_rank_cd`, backed by a GIN index. Semantic candidates have HNSW support. For heavily filtered corpora, approximate retrieval can underfill candidate sets; filtered ANN recall and index tuning remain unverified on real data in this session.

Reciprocal Rank Fusion sums `1 / (60 + rank)` separately for each branch and never combines raw cosine and FTS scores directly. Optional deterministic lexical overlap provides a lightweight reranking stage, not a learned cross-encoder. Final K, branch candidate counts, chunking, source budget, and reranking are configurable. Keyword-only search can be used without an online embedding request, but still requires documents that previously completed indexing under the current identity.

## Generation and source validation

Retrieved sources are deduplicated and bounded. Source IDs are assigned as S1, S2, etc. The prompt clearly labels excerpts as untrusted data, requests source-grounded answers, and prohibits tool execution and secret disclosure. Recent completed turns are included under a fixed bounded history budget. No unlimited memory or invented summary is added.

The provider streams text. An incremental guard holds incomplete citation brackets and rejects out-of-range S-identifiers before they are emitted. Final validation requires at least one valid citation when evidence was used; malformed/nonexistent references fail the answer. A response remains provisional until `generation_completed`. No-evidence retrieval produces a deterministic limitation message without calling the LLM. That message describes an actual empty retrieval outcome and is not represented as model output.

Source cards open an authenticated document preview and the exact cited excerpt/page/section. Precise PDF highlighting is not claimed. Citation existence does not prove factual support; manual inspection and generation-faithfulness testing remain necessary.

## SSE contract

`POST /api/v1/conversations/{id}/stream` takes `{question, generation_id}`. The UUID is stable for that attempt. Reusing it returns 409 rather than appending duplicate output. Only one active generation per conversation is admitted under a conversation row lock. Attempts left streaming for over five minutes can be marked interrupted on the next request.

| Event | Payload |
|---|---|
| message_started | generation_id |
| retrieval_completed | count |
| token_delta | delta |
| generation_completed | generation_id, citations |
| generation_failed | generation_id, error |

The shared fetch-based SSE parser handles split frames, aborts, failures, and missing terminal events. It does not reconnect blindly. A cancellation or disconnected provider persists an interrupted/failed partial message. A browser reload fetches persisted conversation state. Tool events and approval state are available through persisted agent-run endpoints; they are not streamed through chat SSE in this version.

Current integration APIs were checked against [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api), [ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai), [ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama), [Ollama embeddings](https://docs.ollama.com/api/embed), [pgvector Python](https://github.com/pgvector/pgvector-python), and [FastAPI response cookies](https://fastapi.tiangolo.com/advanced/response-cookies/). Actual paid/local model connectivity was not tested in this session.
