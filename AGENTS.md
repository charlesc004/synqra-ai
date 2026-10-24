# Project language policy

All first-party project content must be written in English. This includes source
code, comments, interface copy, prompts, fixtures, tests, documentation, reports,
configuration, and file names. Do not introduce Persian or Arabic-script text or
Persian/Arabic digits into these files. Conversation with the user may still use
their preferred language.

Preserve Unicode handling coverage with English text and emoji rather than
non-English prose. Do not modify third-party dependencies or their Unicode tables
to enforce this policy.

Run `npm run check:english` after changing project content. Keep generated reports
in English as well. Follow the additional Next.js guidance in `apps/web/AGENTS.md`
when modifying the frontend.
