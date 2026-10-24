# SYNQRA AI

**Intelligence Connected to Your Knowledge**

A Next.js and FastAPI knowledge workspace with PostgreSQL/pgvector retrieval, Redis/RQ ingestion, cited streaming chat, and a bounded LangGraph workflow with durable human approval.

This repository contains a substantial implementation, not a claim that the entire master brief is production verified. See [verification and remaining work](docs/implementation-report.md). No provider credentials are bundled. Missing AI configuration is shown explicitly; the application never substitutes canned answers for live AI. The deterministic provider in `tests/fixtures` is used only by the E2E test environment.

## Start with Docker

Requirements: Docker Engine/Desktop with Compose v2. Node 22+ and Python 3.12+ are needed only for development outside Docker.

```powershell
Copy-Item .env.example .env
# Edit .env: set POSTGRES_PASSWORD and SEED_PASSWORD (12+ characters).
docker compose up --build -d
docker compose exec api python apps/api/scripts/seed.py
```

Open [SYNQRA](http://localhost:3000) and [API documentation](http://localhost:8000/docs). Migrations and graph checkpoint setup run through the one-shot `migrate` service before the API and worker start.

Seeding creates the fictional **Northstar Digital Operations** workspace, three collections, 12 documents, and two explicitly fictional action items. Accounts use your `SEED_PASSWORD`: `alex@northstar.example` (owner), `jamie@northstar.example` (member), and `casey@northstar.example` (viewer). Seeding again does not reset passwords or duplicate records. Documents stay queued, failed, or awaiting configuration until real indexing succeeds.

Fresh registration creates a separate personal workspace. Signing into a seeded account opens Northstar. For production, avoid seed accounts, use HTTPS and `COOKIE_SECURE=true`, change local database credentials, and configure a trusted reverse proxy.

## Connect a model

For OpenAI, configure these server-only variables in `.env`:

```dotenv
AI_PROVIDER=openai
CHAT_MODEL=<a chat model available to your account>
OPENAI_API_KEY=<your server-side key>
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=<an embedding model available to your account>
EMBEDDING_DIMENSION=<the model's exact output dimension, up to 2000>
MODEL_SUPPORTS_STRUCTURED=true
```

Verify the selected chat model supports JSON-schema structured output before enabling that flag. `MODEL_SUPPORTS_TOOLS=true` enables one bounded, real model-generated search tool call in document-free agent runs; enable it only after verifying tool support. The default graph uses explicitly selected workflows and the same validated tool registry without requiring model tool selection. Model names are configuration, not application constants. OpenAI-compatible endpoints can be configured by a trusted operator with `OPENAI_BASE_URL`; users cannot submit endpoints through the API.

For Ollama, install it separately and pull a chat model plus a distinct embedding model suitable for your hardware. Configure:

```dotenv
AI_PROVIDER=ollama
CHAT_MODEL=<your installed chat model>
OLLAMA_BASE_URL=http://host.docker.internal:11434
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=<your installed embedding model>
EMBEDDING_DIMENSION=<its exact dimension>
```

Ollama needs enough RAM/VRAM for your chosen models and context length; small quantized models can still need several GB. Check the model's actual context and structured/tool capabilities. For host-based development, use `http://localhost:11434`. Container access depends on Ollama's listening interface and host firewall; expose it only to trusted local clients.

After configuration changes, recreate the API and worker with `docker compose up -d --force-recreate api worker`. In Knowledge Base, select each collection and click **Reindex collection**. For newly uploaded files in a matching collection, **Retry** is sufficient. Model identity changes require reindexing. **Dimension changes require an explicit database migration to alter the vector column and rebuild HNSW, then full reindexing**; changing the environment alone is insufficient. For a brand-new database, set dimensions before the first migration. No destructive reset command is prescribed.

Settings shows provider/model listing connectivity and declared capabilities. “Connected” does not claim that a generation or embedding request has been tested. Actual requests validate provider errors, vector counts/dimensions, structured output, and citation identifiers.

## Local development

Run PostgreSQL/pgvector and Redis, for example with `docker compose up -d postgres redis`, then use a virtual environment:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -e 'apps/api[dev]'
.venv/Scripts/python -m alembic -c apps/api/alembic.ini upgrade head
.venv/Scripts/python apps/api/scripts/init_checkpoints.py
.venv/Scripts/python apps/api/scripts/seed.py
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# Separate terminals:
.venv/Scripts/python -m app.worker
npm ci
npm run dev
```

RQ's fork worker is intended for Linux/Docker. On Windows, run the worker in Docker or WSL. The Next.js development proxy defaults to port 8000; `API_INTERNAL_URL` changes that trusted upstream. The Docker frontend embeds `http://api:8000` at build time because Next.js rewrites are build configuration. Development and production use separate `.next-dev` and `.next` directories. Webpack is selected explicitly to avoid a Turbopack process-launch failure encountered on this Windows host.

First use of `tiktoken` downloads its public tokenizer vocabulary; the API Docker image preloads it. Backend dependencies are declared in `pyproject.toml`; `requirements.lock` records the exact Windows/Python 3.14 packages installed during this implementation, not a verified cross-platform lock. The frontend has an npm lockfile.

Set `MODEL_CONTEXT_TOKENS` to the selected model's verified context capacity and `MAX_OUTPUT_TOKENS` to the desired bounded output. The source budget reserves room for the question, prompt, history, and output. Ollama receives the configured context/output limits; token counts use cl100k_base as a documented approximation for other tokenizers.

## Features and shared infrastructure

- Cookie authentication, rotation, password changes, role checks, isolated workspaces, membership management, and private uploads.
- PDF, DOCX, TXT, and Markdown parsing; provenance-preserving chunks; provider embeddings; transactional vector replacement; retryable background jobs.
- Shared semantic/keyword/hybrid retrieval, RRF, optional deterministic lexical reranking, and collection/document filtering.
- Persistent chat with bounded history, SSE, cancellation, safe Markdown, valid source previews, and rename/delete controls.
- Research, summary, comparison, extraction, and action proposal workflows; persisted graph interrupts and explicit approval/rejection.
- Action board, retrieval benchmarks, measured usage charts, error states, and audit events.
- One HTTP client, SSE parser, application shell, query provider, document list/uploader/preview, source card, modal foundation, approval dialog, table, pagination, and error presentation.

The interface uses Tailwind with a project stylesheet, shadcn-style button composition, Radix dialogs/slots, TanStack Query, React Hook Form/Zod authentication, Lucide icons, React Markdown, and a lazy-loaded Recharts chart.

## Tests

All first-party project content is maintained in English. Run `npm run check:english`
to check source files, documentation, fixtures and filenames for Arabic-script text
or Arabic/Persian digits. The same check runs in CI; see `AGENTS.md` for the policy.

The latest local verification passed **57 backend/integration/agent tests, 12 Vitest tests and 15 Chromium scenarios**, with no skips or flaky browser cases. A responsive axe audit covers 52 states across four widths. Patched pip, nonce-based production CSP and real dependency readiness/outage tests are documented in the [hardening report](docs/security-hardening.md). See the [comprehensive audit](docs/comprehensive-audit.md) and [test report](docs/testing-report.md) for evidence and remaining limits. The isolated Docker stack is `tests/compose.yml`; its AI responses are explicitly controlled fixtures.

```powershell
.venv/Scripts/python -m ruff check apps/api
.venv/Scripts/python -m mypy apps/api/app --config-file apps/api/pyproject.toml
.venv/Scripts/python -m pytest apps/api/tests -q
npm run typecheck
npm run lint
npm run test:frontend
npm run build
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL instance with extension-creation privileges to run real pgvector tests. Tests create unique schemas and remove only those schemas. Without it, four integration tests explicitly skip; they are never represented as a tested vector-store substitute.

GitHub Actions defines backend service tests, frontend checks/build, and Playwright tests against an isolated deterministic OpenAI-compatible fixture plus real PostgreSQL/Redis and the real worker. Run `npm run test:e2e` only against that controlled test setup; the tests expect the fixture's explicitly labeled content, not a live model's prose. CI has been authored but has not been executed in this local session.

## Project layout

```text
apps/web/src/
  app/                 App Router auth and workspace pages
  components/          shell, Radix/shadcn-style primitives, shared UI
  features/            auth, dashboard, knowledge, chat, agents, actions, evaluations, settings
  lib/                 typed API client, SSE parser, shared DTOs and utilities
  providers/           QueryClient and authenticated workspace context
  styles/              responsive interface and design tokens
apps/api/
  app/core/            settings, SQLAlchemy sessions, authentication/authorization
  app/modules/         feature routers and action service
  app/ai/              providers, ingestion, retrieval, RAG, tool registry, graph, evaluation
  app/jobs/            shared RQ job submission
  app/shared/          workspace/document access and audit helpers
  app/models.py        relational entities and vector/full-text indexes
  alembic/             frozen initial schema migration
  scripts/             idempotent seed and durable-checkpoint initialization
  tests/               deterministic unit and optional real PostgreSQL integration tests
datasets/              fictional corpus and benchmark
tests/                 Playwright workflows and isolated HTTP model fixture
docs/                  design decisions, event contract, audit, and limitations
```

See [architecture](docs/architecture.md), [RAG design](docs/rag-pipeline.md), [agent/approval design](docs/agent-workflow.md), [evaluation methodology](docs/evaluation.md), and [implementation report](docs/implementation-report.md).
