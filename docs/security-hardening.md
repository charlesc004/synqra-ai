# Production hardening follow-up

Verified on 25 October 2026. This follow-up addresses the three requested findings from the comprehensive audit: pip advisories in the Python image, permissive CSP, and dependency readiness. The rebuilt isolated stack passed **84 tests** with no skips, failures or flaky browser cases.

## Python image

The Python base is pinned to multi-platform digest `sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704` (Python 3.12.15 on the tested Linux/amd64 platform). pip 26.2.2 is installed from an explicit wheel URL with SHA-256 `fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70`, before installing application dependencies. The release and checksum are published by [PyPI](https://pypi.org/project/pip/26.2.2/) and [Python.org](https://www.python.org/downloads/release/python-31317/).

The OSV inventory scan now exits unsuccessfully if findings exist, as well as when the advisory service is unavailable. The previous inventory scan is retained as `test-reports/python-audit-before-hardening.json`; the rebuilt runtime is scanned into `test-reports/python-audit.json`.

## CSP

`apps/web/src/proxy.ts` generates a cryptographically random 256-bit nonce per request, overwrites any client-supplied nonce/CSP header and supplies the same policy to Next rendering and the browser response. Root layout reads request headers to force dynamic rendering. HTML responses are private and non-cacheable so HTML and nonce cannot be shared across requests.

Production scripts require a nonce and use `strict-dynamic`; neither `unsafe-inline` nor `unsafe-eval` is permitted for scripts. Style elements require a nonce or the same origin. Radix's dynamic style elements receive the current document nonce through `get-nonce`. Style **attributes** remain explicitly permitted for React/Radix/chart positioning. This exception does not permit inline scripts or arbitrary style elements. Objects and base URL changes are prohibited, forms and network requests are restricted to the same origin, and framing is prohibited.

Development alone permits eval for React debugging and WebSocket connections for HMR. The browser CI job now builds and runs production Next.js so it verifies the enforced production policy.

Authentication validation sets Zod's `jitless` configuration before creating schemas. This prevents its JIT capability probe from calling `Function` and generating a CSP violation; validation continues through the interpreted path. See [Zod's CSP guidance](https://zod.dev/compile).

Nonce rendering disables static HTML optimization and shared CDN HTML caching. Static JS/CSS assets retain their normal caching. Any deployment/CDN must preserve the response CSP and must not cache these HTML responses. HTTPS termination remains the deployment's responsibility; local HTTP development is supported.

The audit executes axe through Playwright's privileged DevTools context, independently of application CSP: axe internally compiles rule templates with `Function`. Production policy is never relaxed for the audit. The 52-state audit also records unexpected browser `securitypolicyviolation` events. A separate adversarial browser case injects payloads into the HTTP document so the browser's HTML parser enforces CSP; it tests nonces across requests and spoofed request headers, rejected untrusted inline script/style elements, and blocked eval inside an authorized script. Using DevTools script execution to simulate the attack would bypass policy and produce a misleading result.

## Liveness and readiness

- `GET /api/v1/health` is process liveness. It remains 200 during a database or Redis outage.
- `GET /api/v1/ready` executes `SELECT 1` against PostgreSQL and `PING` against Redis. It returns 200 only when both work, and 503 otherwise, with boolean dependency statuses and `Cache-Control: no-store`. It never returns credentials, connection strings or exception details.
- The database probe uses a separate one-connection pool with a 2-second pool wait, connection timeout, statement timeout and TCP user timeout; TCP keepalive is also shortened. Redis has 2-second connect/read timeouts with no automatic retries. Both checks run concurrently with a **3-second overall deadline**, including slow DNS resolution. Two shared probe threads and reuse of an in-flight check prevent timed-out requests from creating an unbounded backlog. Docker allows 8 seconds for HTTP and has a 10-second command timeout; host scheduling can still influence precise wall-clock timing.
- Both Compose configurations and CI startup checks use readiness to gate dependent services. The frontend is not gated on paid/optional model credentials.

The real outage check in `tests/readiness_outages.py` stops Redis, PostgreSQL and both together in the **synqra-test** project only; it checks 503 readiness, 200 liveness, response time and successful recovery. Dependencies are restarted in a `finally` block. The worker is gracefully paused before fault injection and restored in an outer `finally` block. This isolates API readiness from worker failover: an earlier run observed RQ's scheduler child exiting during Redis loss while its parent continued accepting jobs. Automatic worker/scheduler failover remains outside this readiness contract. Run it separately from application tests because it intentionally interrupts those dependencies:

```sh
python3 tests/readiness_outages.py
```

Readiness does not certify model quality, worker throughput, backups or availability under high load. Those are separate from these dependency checks.

## Verification

| Check | Final result | Evidence |
|---|---|---|
| Backend, database, authorization, agents and readiness | 57 passed in 7.08 seconds | `test-reports/backend.xml` |
| Frontend client and SSE | 12 passed | `test-reports/frontend.xml` |
| Production Chromium workflows and adversarial CSP | 15 passed in 87.1 seconds; zero skipped/failed/flaky | `test-reports/playwright.json` |
| Responsive accessibility and unexpected CSP events | 52 states; zero automatic violations, JS/CSP errors or page overflow | `test-reports/audit/accessibility.json` |
| Actual Redis, PostgreSQL and combined outages | 503 in 3.009 / 3.003 / 3.006 seconds; liveness 200; readiness recovered to 200 | `test-reports/readiness-outages.json` |
| OSV scan of deployed Python inventory | 82 packages; zero findings | `test-reports/python-audit.json` |
| npm audit | Zero reported vulnerabilities | `test-reports/npm-audit.json` |
| pip consistency and version | No broken requirements; pip 26.2.2 | `test-reports/hardening-runtime.txt` |
| TypeScript, E2E TypeScript, ESLint, Ruff, mypy | Passed; 24 Python modules | Local command output |
| Final Docker production builds | Passed | `.tmp/hardening-api-final.log`, `.tmp/hardening-web-final.log` |

The 33 axe cases containing manual-review entries remain explicitly outside a complete WCAG certification. No live model credentials, hosted CI, load test or real-device validation were used. Linux application dependencies still use version ranges from pyproject; base-image and pip artifacts are now pinned, while a complete hash-locked application dependency supply chain remains separate release work.
