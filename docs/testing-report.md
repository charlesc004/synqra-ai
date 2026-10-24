# Local test and review report

Verified on **25 October 2026**, using Windows for frontend checks/Chromium and Ubuntu 24.04 WSL Docker for the application stack. The final result is **84 passing tests, zero skipped, zero failing**, with no flaky browser cases. See the [security hardening follow-up](security-hardening.md) and [comprehensive audit](comprehensive-audit.md) for fixes, evidence and remaining release work.

| Suite | Actual result | Evidence |
|---|---:|---|
| Python unit + HTTP + PostgreSQL + LangGraph | 57 passed in 7.08s | `test-reports/backend.xml` |
| Vitest API client and SSE | 12 passed | `test-reports/frontend.xml` |
| Chromium Playwright workflows | 15 passed in 87.1s | `test-reports/playwright.json`, `playwright-report/index.html` |
| Responsive axe audit | 52 cases across 1440/768/390/320px; zero automatic violations, JS errors or page overflow | `test-reports/audit/accessibility.json` |
| Frontend TypeScript / ESLint | Passed | Command output |
| Python Ruff / mypy | Passed, 24 application modules checked | Command output |
| Final production Docker builds | Passed | `.tmp/hardening-web-final.log`, `.tmp/hardening-api-final.log` |
| Real migrations + checkpoint initialization | Passed | Running PostgreSQL schema and migration service |
| Runtime evidence | Real vectors, indexes, document states, checkpoints, Redis | `test-reports/runtime.json` |

The dark theme and sidebar redesign is documented in `docs/theme-redesign.md`. Its responsive browser coverage now includes all seven workspace pages, desktop rail navigation, mobile drawer behavior, first-screen chat composer visibility, and login/registration layouts. Final screenshots are saved in `test-reports/theme/`.

## Running application

- Web: [http://localhost:3010/login](http://localhost:3010/login)
- API/OpenAPI: [http://localhost:8010/docs](http://localhost:8010/docs)
- Fictional owner: `alex@northstar.example`
- Test-only password: `ci-fixture-password-2026`
- Viewer: `casey@northstar.example`, same test-only password.

The UI explicitly displays a test-environment banner. The model is an isolated deterministic OpenAI-compatible **HTTP fixture**, not OpenAI/Ollama inference. PostgreSQL, pgvector SQL retrieval, Redis, the RQ worker, checkpoint persistence, HTTP authentication and the frontend are real. Controlled embedding vectors test storage/ranking/integration mechanics, not the semantic quality of a real embedding model. No paid credentials were used.

The isolated Compose project is `synqra-test`, with separate PostgreSQL and file volumes and localhost ports 3010/8010/15432/16379. Existing unrelated containers and databases were not changed. On this host, a foreground WSL session is retained because WSL idle termination would otherwise stop Docker. The original standalone development previews on ports 3000/3001 are separate from this complete test stack.

## Exercised workflows

The browser suite covers login, workspace identity, upload and actual indexing, authorized hybrid search, SSE answers and source previews, saved conversations, comparison, proposed action approval, an action appearing on the board, retrieval evaluation and result inspection, no-evidence behavior, rename without losing collection scope, deletion, and viewer write denial.

Additional browser cases cover invalid citation rejection, real HTTP provider failure, cancellation with a provisional/interrupted state, agent rejection, summary, structured extraction, a LangChain-bound search tool call, and a transient embedding failure followed by a real delayed RQ retry to Ready. A 390px mobile screenshot was inspected, with overflow and navigation assertions. The desktop history click exercises the sidebar scroll fix.

Database-backed tests cover actual cosine/FTS/RRF retrieval, document isolation, private document access, idempotent vector replacement, cookie/CSRF/Origin enforcement, session rotation/logout, preserved collection scope, persistent graph interrupt/resume through a fresh checkpointer, rejection, revoked membership role, foreign-workspace denial and concurrent exactly-once action creation.

## Fixes made during testing

1. SSE framing now normalizes CRLF after joining network chunks. Splitting CR and LF between reads no longer produces a false interrupted-generation error; UTF-8 byte splits are also tested.
2. Sidebar sections no longer shrink underneath the footer. At a short desktop height the history remains scrollable and clickable.
3. Renaming a conversation updates only fields explicitly supplied. It preserves the collection; loading the conversation shows its saved scope in the composer.
4. Ingestion distinguishes scheduled `retrying` from terminal `failed`. The document list continues polling through a real RQ retry and prevents duplicate manual retry submission while one is scheduled.
5. Browser selectors now target the intended workflow panel/current record and error region, avoiding collisions with prior run history and Next.js's route announcer.
6. Added an explicitly labeled test mode, an isolated Compose stack and a dedicated backend test image with writable cache/report directories.

## Reproduce

In a Linux/WSL shell at the repository root:

```sh
docker compose -f tests/compose.yml up --build -d
docker compose -f tests/compose.yml exec -T api python apps/api/scripts/seed.py
docker compose -f tests/compose.yml build checks
docker compose -f tests/compose.yml run --rm checks
docker compose -f tests/compose.yml exec -T api python - < tests/verify_stack.py > test-reports/runtime.json
```

Keep the WSL shell/session active on hosts with idle shutdown. In Windows PowerShell at the repository root:

```powershell
npm ci
npm run test:frontend
$env:E2E_BASE_URL='http://localhost:3010'
npm run test:e2e
npm run typecheck
npm run lint
```

The suite retains test data. After repeated rapid runs, login/agent rate limits can legitimately apply. The guarded `tests/reset_limits.py` clears only counters in `TEST_MODE`, preserving jobs and database content:

```sh
docker compose -f tests/compose.yml exec -T api python - < tests/reset_limits.py
```

Do not run the system suite against production. To stop this isolated stack without removing its data, use `docker compose -f tests/compose.yml stop`.

## Limits of this result

Passing 84 tests does not establish complete code coverage or production readiness. The automated axe audit has zero violations but 33 cases contain manual-review items; this is not WCAG certification or a screen-reader audit. Real OpenAI/Ollama compatibility and answer quality, broader prompt-injection resistance, Firefox/WebKit, high-load behavior, abrupt in-flight worker crashes and every possible concurrency boundary remain outside this run. pip advisories, CSP and readiness were fixed and retested; application dependency hash locking and worker failover remain separate release work. See `security-hardening.md`. GitHub Actions definitions were updated, but hosted CI was not invoked. Other unfinished product requirements remain listed in `implementation-report.md`.
