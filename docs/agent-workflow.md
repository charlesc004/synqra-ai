# Agent workflow and approvals

One typed LangGraph StateGraph runs:

`START → retrieve → generate → [approval interrupt for action workflows] → END`

Workflow selection is an explicit validated enum: answer, summarize, compare, extract, action. This avoids an unbounded autonomous planner. The graph has a recursion limit of eight and a 180-second execution timeout. Provider requests have their own timeouts and bounded outputs. The state contains the run ID, selected evidence, result, and approval ID; authenticated actor and workspace come from the backend, never from generated content.

Selected-document workflows validate each document through the same document-access service and take bounded excerpts. Comparison requires at least two distinct documents and rejects a context selection that omits one of them. Extraction and comparison use Pydantic structured outputs only when the operator explicitly enables verified model support. Missing values remain null/empty rather than inferred. Research/summary use cited generation. Summary and comparison currently inspect bounded excerpts; they are not exhaustive whole-document analysis for large files.

The explicit registry contains `search_knowledge`, `get_document_excerpt`, `compare_documents`, `list_action_items`, and `create_action_item`. Arguments use Pydantic schemas, reads are bounded, and workspace/document rules are shared with ordinary APIs. When enabled for a model with verified tool support, one actual LangChain-bound search tool call can prepare a research query. The backend restores the authoritative requested collection before execution. There is no recursive tool loop. Write tool calls never originate from a model-generated approval flag.

## Approval transaction

1. The model proposes a title, description, and valid source labels.
2. The backend maps labels to real source document IDs and validates an `ActionBody`.
3. A unique Approval row stores the exact parameters. The run becomes `awaiting_approval`.
4. LangGraph `interrupt` persists a pause in PostgreSQL checkpoints, scoped to workspace, creator, and run.
5. The interface shows the workspace, operation, title, description, date, and source IDs.
6. The authenticated run creator explicitly approves or rejects. Role and current source/assignee access are rechecked under an approval row lock. An audit records who decided and when.
7. `Command(resume=...)` resumes the graph. Rejection finishes without creating an action.
8. Approval execution reloads membership and locks the approval. Existing action lookup plus a unique `approval_id` constraint prevents duplicate action creation, including concurrent retries.
9. The action and execution audit commit together. Run results and checkpoints record completion. If resume fails after saving a decision, retrying that same decision is safe.

Relational approvals/actions are authoritative; checkpoints alone do not authorize a write. Reversing an existing decision is rejected. A user whose write role was revoked cannot execute an earlier approval. Approvals currently support the proposing run's creator; delegation of approvals to other administrators is not implemented.

Graph step events contain tool/workflow names, status, timestamps, and measured durations. They do not contain private reasoning or chain-of-thought. Events/results are fetched after a request or through the run endpoints. Continuous graph-event SSE, browser stop/resume controls for running agents, persistent agent cancellation, and long-running job dispatch are remaining work. Chat has a separate abortable stream.

Run persistence does not imply that every worker/crash/concurrency scenario has been exercised. The local PostgreSQL suite now verifies a persisted interrupt resumed through a fresh saver/compiled graph, rejection, role revocation, workspace denial and concurrent exactly-once action execution. Playwright exercises the graph through actual HTTP providers and approval UI using the controlled fixture. Abrupt process crashes during a checkpoint write and simultaneous graph resumes require additional resilience tests before production acceptance.
