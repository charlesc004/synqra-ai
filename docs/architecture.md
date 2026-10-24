# Architecture and security boundaries

SYNQRA is a modular monolith: one FastAPI codebase serves business APIs and is imported by a separate RQ worker. Next.js provides one shared workspace application, with a same-origin `/api` proxy. PostgreSQL owns durable business records and LangGraph checkpoints. Redis owns job scheduling and shared rate counters. Private source files are held outside web assets in a Docker volume.

## Data model

Users have hashed passwords and hashed opaque session tokens. Memberships bind a user to a workspace and role. Collections pin embedding provider/model/dimension identity and an index version. Documents retain upload identity, visibility, content hash, version, status, private storage key, and extracted preview. Chunks retain page/heading/token offsets, text hashes, embedding identity/version, pgvector data, and a PostgreSQL full-text vector.

Conversations belong to one workspace and one user. Messages store completion state, provider usage metadata, and validated citation snapshots referencing document/chunk IDs. Agent runs own typed request state, results, and user-facing events. Approvals independently persist the exact proposed action and decision identity/time. Actions have a unique nullable approval foreign key. Evaluations persist configuration, case results, measured metrics, and errors. Usage and audit tables record operational metadata without logging raw source documents or prompts.

The initial Alembic revision explicitly freezes table definitions and indexes. Dimension is chosen on initial creation; later dimension changes need a deliberate migration. Application defaults supply IDs/timestamps when ORM records are created. Direct SQL insertion must supply mandatory columns. Graph checkpoint tables are initialized separately with the supported PostgresSaver setup method.

## Authorization

Every protected feature resolves membership from the authenticated session and `X-Workspace-Id`. The header selects a workspace; it never grants access. A viewer can read accessible knowledge and use read-only workflows. Members can upload, organize collections, and create approved or explicit human actions. Owners/admins manage workspace settings, members, evaluations, usage, and auditing. Only an owner can grant admin access or change an existing admin's membership. Ownership transfer is not implemented.

Both SQL retrieval branches include workspace and document-visibility filters before ranking results are returned. A private document is accessible only to its uploader, including when the requester is an admin. Shared document deletion is restricted to the uploader or an admin. Conversations and agent runs are private to their creator. Source preview applies authorization again. Membership and write authorization are rechecked on action execution.

Argon2 hashes passwords. Cookies are HttpOnly for sessions and SameSite=Lax; Secure is configurable for HTTPS deployments. All cookie-authenticated mutations require an allowed Origin and a session-bound CSRF header. Login and registration additionally check Origin and use Redis rate limits. A database or Redis outage returns an explicit service error. Session refresh rotates a single-use token under a row lock. Password changes revoke all old sessions. Validation responses omit raw submitted input.

## File and tool boundaries

The upload API bounds bytes before persistence, validates extensions and basic binary signatures, and rejects empty files. Storage keys are generated, not taken from filenames. Storage path resolution prevents traversal. Uploading a file does not serve it publicly. The parser limits pages, extracted text, and expanded DOCX size, and runs in a time-bounded worker process. Antivirus, process-level memory isolation, and enterprise content scanning remain future hardening.

The tool registry exposes only bounded knowledge reads, comparison inputs, action listing, and approved action creation. It has no shell, SQL, arbitrary HTTP, filesystem browsing, or secret access tool. Provider URLs are operator-owned environment settings and not user-submitted endpoints. Retrieved text remains untrusted prompt data. Citation validation checks identity, not whether a claim is actually entailed by its source.

## Deployment and operational limits

Compose binds exposed services to localhost and starts migrations before the API/worker. Use a TLS proxy with upload/request limits, `COOKIE_SECURE=true`, managed backups, private database/Redis networks, restricted provider egress, process memory limits, dependency scanning, and secret management before a production rollout. Production CSP uses per-request nonces and blocks eval; required React/Radix style attributes remain explicitly permitted. `/api/v1/ready` checks PostgreSQL and Redis with a three-second deadline, independently of process liveness. See [security hardening](security-hardening.md). Local Docker migrations/startup, real worker ingestion/retries and concurrent action execution were verified; abrupt in-flight crash recovery and production deployment require further validation.

SQLAlchemy sessions are synchronous; async workflows await provider I/O but still execute synchronous DB calls. This is adequate for a small portfolio dataset and requires load testing and likely async DB refactoring for higher throughput. No throughput/SLA claim is made.
