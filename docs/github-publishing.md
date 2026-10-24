# Publishing to GitHub

The repository uses the `main` branch. Local dependencies, environment files, private
keys, uploaded documents, logs, caches, build outputs and generated test reports are
excluded from Git. `.env.example` contains development placeholders, not production
credentials. The accounts and credentials in `tests/compose.yml` are isolated test
fixtures and must never be reused in production.

The initial commit message is:

```text
feat: initialize SYNQRA AI knowledge workspace

Implement the Next.js and FastAPI workspace with pgvector retrieval,
streaming cited chat, document ingestion, and durable agent approvals.

Add responsive dark UI, nonce-based CSP, dependency readiness checks,
security regressions, CI workflows, and English-only content validation.
Document local verification and remaining production limitations.
```

Create an empty GitHub repository without an initial README, license or gitignore.
Use its exact SSH or HTTPS remote URL, then run from the project root:

```sh
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

If `origin` is already configured, inspect it with `git remote -v` before changing
anything. Do not embed an access token or password in the remote URL. GitHub's own
authentication flow or an SSH key should supply credentials.

Before subsequent pushes:

```sh
npm run check:english
npm run typecheck
npm run lint
npm run test:frontend
git diff --check
git status
```

The full local system suite and reproducible commands are documented in
`docs/testing-report.md`. GitHub Actions runs frontend, backend and browser checks
after the repository is pushed; hosted CI has not been run by this preparation step.
