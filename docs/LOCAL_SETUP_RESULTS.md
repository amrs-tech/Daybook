# Local setup verification — 6 November 2026

Project extracted to E:\experiments\daybook-agent-v21. Original attachment unchanged.

- Node v22.22.2 / npm 10.9.7.
- npm ci: successful; audit reported zero vulnerabilities at install time.
- Local environment generated, empty credential fields added, all three migrations applied.
- Typecheck: passed.
- Unit tests: 77 passed.
- Integration tests: 47 passed; 3 independent PostgreSQL race tests skipped pending dedicated database.
- Production build: passed.
- Persistence smoke: approved synthetic expense reread from receipt/journal in a separate Node process.
- Fixture evaluation: 8 measured, zero failures; 64 of 72 cases unrun in replay mode.
- Browser suite first run: 6 passed, first test timed out during cold development startup in beforeEach.
- Targeted rerun of first test on warm server: passed (14 seconds). Thus all seven browser scenarios passed across the two runs; a single clean full-suite pass is not claimed. Current playwright-results.json contains the targeted rerun only.
- Live Gemini, ElevenLabs, Langfuse, Supabase and deployment: not verified; credentials absent.

Development server started on http://localhost:3000 during setup. If it stops, run npm run dev from the project directory. Stop it before opening the same local database from a standalone command or running a build.

Next steps: edit .env.local using docs/WINDOWS_SETUP.md, then ask to continue live verification. Hosted/deployed two-user workflows and real microphone checks remain required. Existing archive evidence files are historical unless explicitly regenerated during this setup; this file records the current results.
