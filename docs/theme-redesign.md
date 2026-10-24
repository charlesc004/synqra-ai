# Neutral dark workspace redesign

The workspace now uses a Grok-inspired monochrome visual direction while retaining SYNQRA's name and audio-line mark. All workspace routes and both authentication pages share the same dark surfaces, neutral typography, rounded controls and restrained borders.

## Visual system

- Canvas `#171717`; sidebar `#101010`; panels `#1c1c1c`; raised surfaces `#252525`.
- Main text `#f1f1f1`; secondary text `#a3a3a3`; borders `#333333`.
- Primary actions use light backgrounds with dark text. Success, failure and approval states retain readable semantic colors.
- Removed lavender surfaces, colored decorative illustrations and the auth orbit graphic. The usage chart and its tooltip use the same dark palette.
- The empty chat puts its composer before suggestion cards so the send control is visible without scrolling at the tested desktop and mobile sizes.

## Navigation

The sidebar has a dedicated new-chat action, knowledge search, page navigation, scrollable recent conversations, workspace selection, model status and account controls. Its desktop rail can collapse and expand without losing page navigation. In the rail, the workspace initial expands the selector. Mobile uses a dismissible drawer; hidden navigation cannot receive keyboard focus. Active links expose `aria-current`, icon controls have accessible labels, and reduced-motion preferences are respected.

## Verification

The production Docker frontend was rebuilt and deployed at `http://localhost:3010`. TypeScript, ESLint and production compilation passed. The regression suites passed: 48 Python backend/agent tests, 12 frontend unit tests and 10 Chromium workflow tests. The full browser run took 40.2 seconds. A final targeted browser check also verifies the mobile authentication correction.

The responsive browser case exercises all seven workspace pages, desktop sidebar collapse/expand, mobile navigation, overflow constraints, initial composer visibility and authentication form visibility. Screenshots are retained under `test-reports/theme/`; machine-readable results are in `test-reports/playwright.json` and `test-reports/theme-playwright.json`.

The running local environment remains explicitly labeled as a test workspace. Its AI provider is a controlled HTTP fixture; these checks do not measure a live model's answer quality.
