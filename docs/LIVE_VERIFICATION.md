# Live verification — 6 November 2026

> Historical snapshot. Current fixes and verification: [7 November fix report](FIX_VERIFICATION_2026_11_07.md). Results below are preserved from their original run.

**Release decision: NOT READY FOR DEPLOYMENT.**

## Passing checks

| Check | Result |
| --- | --- |
| Unit tests | 80 passed |
| Integration tests | 50 passed, zero skipped; includes all 3 independent PostgreSQL race tests |
| Replay browser suite | 7 passed in one run |
| Hosted Supabase browser/API scenarios | 16 passed |
| TypeScript | Passed |
| Production build | Passed after the Gemini compatibility fix |
| npm dependency audit | Zero reported vulnerabilities |
| ElevenLabs live transcription | Synthetic speech recording transcribed with the correct 250-rupee amount; authenticated route and retry idempotency passed |
| Langfuse | Successful hosted Planner and Writer observations retrieved through Observations API v2; input/output content absent |

Hosted scenarios verified actual email/password login, separate workspaces, unauthenticated access denial, wrong-origin denial, local-demo login rejection, owner-scoped exports, cross-user source/draft denial, live Gemini draft creation, explicit approval, receipt/journal persistence, duplicate approval returning the same receipt, and owner-scoped voice transcription.

One explicitly synthetic 10-rupee expense was committed to test user A's ledger. No real funds moved. Existing test accounts were supplied by the user; no additional Auth users were created.

## Release blockers

The complete 72-case live evaluation was executed with gemini-3.1-flash-lite-preview after fixing the provider schema rejection:

- 8 cases completed; 64 failed.
- 23 failures were evidence or rejected-operation validation errors: 9 UNVERIFIED_HINT, 1 UNVERIFIED_PLANNER_EVIDENCE, 5 INVALID_REJECTED_STEP, 7 MISSING_FIELD_EVIDENCE:paymentMethod, 1 UNVERIFIED_WRITER_EVIDENCE.
- 41 failures were GEMINI_TRANSIENT_FAILURE. The provider adapter groups rate, service and abort failures under this code; the exact mix is not established. One of these cases (E022) succeeded in a later diagnostic run. The original evaluation outcome is retained.
- Among the 8 completed cases, operation sequence matched in 7/8, critical fields matched in 0/1 applicable case, and clarification was detected in 2/3 cases requiring it. These are partial denominators, not overall accuracy.

The evidence guards correctly reject unverified model facts. Do not weaken them to improve the score. The live model's reliability and provider behavior need work before rerunning the evaluation with suitable pacing and clear error diagnostics.

Human microphone recording, permission denial, browser pause/cancel behavior with a physical microphone, and an evaluation using labeled human recordings remain unverified. The successful speech test used Windows-generated synthetic speech. Deployment/HTTPS runtime checks have not been performed.

## Configuration and code corrected during verification

- Encoded the database password's reserved URL characters and quoted the connection value locally.
- Applied the three migrations to the dedicated empty Supabase project.
- Created the restricted daybook_backend login, granted daybook_server membership, and saved its application connection in ignored .env.local. Verified it has no superuser, bypass-RLS, role creation or database creation privileges. Direct administrator-table access is denied; 20 public tables have RLS enabled.
- Created a separate disposable database for independent-session races. The ignored .env.verification-admin.local retains the maintenance administrator connection and the restricted test-database connection. Do not deploy that file.
- Added lib/agent/gemini-schema.ts to project the Zod schemas into a form accepted by the configured Gemini model. Literal versions remain enums and object fields remain strict. Provider-side nested array bounds and unsupported string constraints are omitted; the full original Zod bounds, patterns and evidence validation still run on every response. Three regression tests cover this boundary.

No secrets were intentionally added to source or evidence. Provider keys, user passwords and database connections stay in ignored local environment files. No deployment was performed and the verification changes have not been pushed to GitHub.

## Evidence

See evidence/live-verification.json for the consolidated results, evidence/evaluation-live.json for all 72 raw evaluation outcomes, and the refreshed unit, integration and browser JSON reports. Historical evidence logs elsewhere in the archive are not current run results.

The hosted development app is available at http://localhost:3000 while the server is running.
