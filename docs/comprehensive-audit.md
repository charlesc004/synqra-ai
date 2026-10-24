# SYNQRA AI comprehensive audit

Verified on 25 October 2026 against the existing source and the isolated local
`synqra-test` stack. The review covered frontend, backend, agents, responsive design,
accessibility, code quality and duplication. This report documents actual checks;
it does not establish exhaustive coverage or unconditional production readiness.

The pip, CSP and readiness follow-up is complete. See the
[security hardening report](security-hardening.md). The final combined result is
**84 passing tests**.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| Python, HTTP, PostgreSQL and agents | 57 passed; no skips | `test-reports/backend.xml` |
| Frontend API client and SSE | 12 passed | `test-reports/frontend.xml` |
| Chromium workflows | 15 passed in 87.1 seconds; zero failed, skipped or flaky | `test-reports/playwright.json` |
| Responsive axe audit | 52 states; zero automatic violations, JavaScript errors or page overflow | `test-reports/audit/accessibility.json` |
| TypeScript and ESLint | Passed, including separate E2E type checking | Local command output |
| Ruff and mypy | Passed; 24 Python application modules | Local command output |
| Production Docker builds | Passed | `.tmp/hardening-web-final.log`, `.tmp/hardening-api-final.log` |
| Duplicate scan at audit completion | 65 files, 11,358 source lines; zero candidates under the method below | `test-reports/code-quality.json` |
| npm audit | Zero reported vulnerabilities | `test-reports/npm-audit.json` |
| Python image OSV scan | 82 packages; zero findings after upgrading pip | `test-reports/python-audit.json` |
| Real PostgreSQL, Redis and combined outages | 503 readiness in approximately 3 seconds; liveness healthy; recovery to 200 | `test-reports/readiness-outages.json` |

## Findings fixed

### Private document disclosure through evaluation snapshots

Before the fix, another administrator in the same workspace could read evaluation
snapshots containing excerpts from someone else's private document. The regression
expected 404 but received 200. Listing and detail endpoints now recheck current access
to every referenced document, including expected documents, retrieved documents and
excerpts. Unauthorized evaluations are omitted from listings and return 404 on direct
requests. Deleting a referenced document also prevents reading its snapshot.

Implementation: `apps/api/app/modules/evaluations.py`. Regression:
`test_evaluation_snapshots_do_not_bypass_private_document_access` in
`apps/api/tests/integration/test_http_security.py`.

### Workspace state and forms

Switching workspaces now remounts page-local state so unsaved chat drafts and form
values do not carry into another workspace. Clearing the workspace name no longer
restores its previous value automatically. Successful action creation clears the due
date. Assignees can see status controls in accordance with backend permissions.

### Mobile layout, readability and keyboard access

- Fixed dashboard overflow at 320px by correcting grid/panel minimum widths.
- Improved footer contrast and verified dark dropdown options and keyboard selection.
- Added accessible names and keyboard focus to scrollable table regions and the file input.
- Made mobile navigation a modal dialog with focus containment, Escape dismissal,
  focus restoration and inert background content.
- Disabled collection and visibility changes during upload.
- Verified the galaxy login animation, mobile layout and reduced-motion behavior.

### Rate limiting and reliable tests

Redis counter increments and TTL assignment now run atomically through Lua. Existing
counters without an expiry are repaired. A real Redis test verifies TTL recovery and
the 429 response when the shared limit is exceeded.

The test worker previously stopped after a Redis timeout, leaving new documents
queued. Its Compose configuration now has `restart: unless-stopped`, matching the main
configuration. The browser retry scenario exercises a transient embedding failure,
the retrying state and a subsequent ready state through the real worker. This does
not establish recovery of every in-flight job after a crash.

Each end-to-end run uploads a document with a unique filename and content and targets
a uniquely named evaluation. Existing records cannot accidentally satisfy these
assertions. Shared test authentication verifies and reuses genuine sessions to avoid
consuming the production login limit through repeated scenarios. Production limits
were not relaxed.

## Clean code and duplication

- Consolidated current-user, workspace and model-status queries into shared hooks;
  five model-status consumers use the same implementation.
- Reused the shared pagination helper in seven backend listings.
- Removed per-row approval queries from agent-run listings by fetching approvals together.
- Replaced ambiguous `object` annotations and repeated Session assertions with proper types.
- Consolidated identical CSS selectors within a block and duplicated test login logic.

The duplicate scan compares exact windows of 12 significant normalized source lines,
excluding comments and TypeScript imports. It also checks identical CSS selector text
within the same block. Zero candidates does not establish the absence of semantic or
architectural duplication. See `tests/code-quality.cjs` and its JSON report.

## Interface and workflow coverage

The audit covered dashboard, chat, knowledge, agents, actions, evaluations and settings
at 1440px, 768px, 390px and 320px. It also covered the Members, AI & Models and Security
settings tabs, the upload dialog, login and registration at those widths: 52 states
with screenshots in total.

Browser scenarios cover fresh upload/indexing, authorized search, SSE answers, source
previews, saved conversations, comparison, summaries, structured extraction, research
tool calls, action approval/rejection, fresh evaluations, missing evidence, conversation
rename/deletion, viewer write denial, cancellation, provider failure, invalid citations,
embedding retries and workspace isolation.

Before-fix evidence is retained in `test-reports/audit/accessibility-before.json`, with
final screenshots in `test-reports/audit/`. Axe has manual-review entries in 33 states,
including gradients, SVG text and clipped scrollable content. Representative desktop,
mobile, table, form and navigation screenshots were visually inspected. This is not
complete WCAG certification or a screen-reader audit.

PostgreSQL, pgvector, Redis, RQ, HTTP authentication and checkpoint persistence are real.
Language-model and embedding requests use an explicitly labeled deterministic HTTP
fixture. These results do not establish live-model semantic quality or final provider
compatibility. Database and index evidence is in `test-reports/runtime.json`.

## Hardening follow-up and remaining release work

pip was upgraded to 26.2.2, the Python base image was pinned to a digest, and a fresh
OSV scan reported no findings. Production scripts require nonces and eval is blocked.
React/Radix style attributes remain explicitly permitted. `/api/v1/ready` checks the
database and Redis with a three-second deadline; Docker and CI startup checks use
this endpoint. Details and active security tests are in `docs/security-hardening.md`.

1. **Dependency reproducibility:** Python/Node base images and the pip artifact are
   pinned. Python application dependencies still use pyproject version ranges; a
   complete Linux application dependency lock with hashes remains separate work.
2. **Recovery and capacity:** Load tests, backup restoration and in-flight worker
   crashes are not fully covered. The readiness outage test pauses the worker before
   fault injection and restarts it afterward; it does not establish automatic
   scheduler failover after Redis loss.
3. **Additional validation:** Live providers, semantic RAG quality, broader prompt
   injection testing, Firefox/WebKit, physical devices, screen readers and hosted CI
   were not exercised. Outstanding requirements in `docs/implementation-report.md`
   remain applicable.

## Reproduce

From the project root in Linux/WSL, using only the isolated test environment:

```sh
docker compose -f tests/compose.yml up --build -d
docker compose -f tests/compose.yml exec -T api python apps/api/scripts/seed.py
docker compose -f tests/compose.yml build checks
docker compose -f tests/compose.yml run --rm checks
docker compose -f tests/compose.yml exec -T api python - < tests/verify_stack.py
```

From PowerShell at the project root:

```powershell
npm ci
npx playwright install chromium
npm run check:english
npm run typecheck
npm run lint
npm run test:frontend
$env:E2E_BASE_URL = 'http://localhost:3010'
npm run test:e2e
node tests/code-quality.cjs
.venv/Scripts/python -m ruff check apps/api
.venv/Scripts/python -m mypy apps/api/app
```

The browser-cache location depends on the execution profile. Set
`PLAYWRIGHT_BROWSERS_PATH` to the cache created by `npx playwright install chromium`
when the test runner uses another profile. Browser access to localhost
was blocked inside the sandbox, so system tests ran with the required network access.
Browser-location and sandbox-network failures were infrastructure failures rather
than application behavior failures. A WSL session was kept active to prevent idle
shutdown from stopping Docker.

Test web: http://localhost:3010/login. API: http://localhost:8010/docs. Accounts and data
are fictional and isolated from production.
