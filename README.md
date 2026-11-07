# DayBook Agent v2.1

A voice and text personal ledger with a bounded Planner, a separate Writer, editable drafts, explicit review, and an immutable balanced journal. Built solely from the two attachments in this chat. The supplied workspace had no existing application; this is a standalone implementation, not a verified upgrade of an unseen repository.

**Release status: reported code defects fixed and automated checks passed; physical microphone acceptance and deployed HTTPS/runtime verification remain pending.** See the [current fix and verification report](docs/FIX_VERIFICATION_2026_11_07.md) for 108 unit, 50 integration, 7 browser, 16 hosted/API checks and the separately labeled live AI evaluations. No deployment is claimed. Fixture replay accepts exact examples only and does not interpret arbitrary instructions.

## Run the local synthetic demo

Use Node.js 22.x and npm. Deployment is pinned to Node 22, matching the latest local verification.

```bash
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`, choose **Explore local demo**, then an example and **Confirm & interpret**. For three expenses, select the date and actual payment account on each card. Save changes and preview, review the financial effects, check approval, then post. Refresh retrieves the persisted batch. No real funds move.

`setup:local` creates an ignored `.env.local` and random local session secret only when the file does not exist. It preserves existing configuration. The local database is PGlite, a PostgreSQL WASM engine persisted to `.local/daybook`. It is allowed only in development with `LOCAL_DEMO_ENABLED=true`. It is serialized and is **not evidence of independent PostgreSQL-session concurrency**. Production rejects both local authentication and this local storage path.

If using a different host or port, set `APP_ORIGIN` to that exact origin. Cookie-authenticated mutation routes reject missing or mismatched origins. Stop the development server before a production build or a standalone command that opens the same persistent PGlite directory.

## What is implemented

- Next.js App Router, TypeScript, Tailwind, responsive financial workspace and strict server-side Zod validation.
- Versioned verbatim Appendix C and D system prompts; separate model invocations; an acyclic LangGraph; one bounded read-only lookup round; maximum three provider invocations including an optional structural repair or eligible fallback.
- Exact INR parsing into bigint paise; explicit account selection; immutable submission reference dates; complete atomic batch review and posting.
- Expenses, income, owned-account transfers, shared payments, loans, claim settlements, unpaid bills, bill payment, constrained corrections, one-time reversals and cash observations.
- A newly created shared-payment claim can be explicitly selected for a later repayment in the same reviewed batch. Amount and counterparty dependencies are validated.
- Owner RLS, a server-only PostgreSQL role, row-locked commit, source/draft/version/hash/revision binding, server-issued commit key, immutable receipts and read-after-write verification.
- Browser recording with start, pause, stop and cancel; local conversion to PCM WAV; explicit Transcribe; editable confirmation; actual frame-duration and streaming size checks; server-side Scribe v2 gateway.
- Redacted Langfuse/OpenTelemetry integration, correlated investigation metadata, fail-isolated tracing and bounded export flush.
- Owner-scoped JSON and formula-safe CSV exports; synthetic seed; demo reset that archives rather than erases history; per-owner and global provider budgets.

## Configuration for real providers and PostgreSQL

Start with `.env.example`. For hosted operation, set `LOCAL_DEMO_ENABLED=false`, leave `LOCAL_DATABASE_PATH` empty, and configure:

| Variable                                                          | Purpose                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `APP_ORIGIN`                                                      | Exact HTTPS application origin                                                |
| `DATABASE_URL`                                                    | Server-only PostgreSQL pooler URL, using a restricted backend login           |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Supabase Auth endpoint and publishable key; neither grants posting privileges |
| `GEMINI_API_KEY`, `GEMINI_MODEL_ID`                               | Actual accessible Gemini model; no default model ID is assumed                |
| `ELEVENLABS_API_KEY`                                              | Server-only Scribe v2 batch transcription credential                          |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Langfuse project and region                                                   |
| `OPENAI_FALLBACK_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL_ID`    | Optional explicitly eligible configured fallback                              |

No service-role key is required or used. The application verifies Supabase users with `auth.getUser`, then sets the verified identity only inside a server database transaction. A browser-supplied owner ID is never trusted. Password sign-in uses existing synthetic Supabase accounts; no public signup or anonymous signup endpoint is provided. Access-token sessions expire; sign in again when expired. Refresh-token rotation is not implemented.

Apply the SQL migrations **as an administrator to a dedicated empty demo database**, using `npm run db:migrate` with its admin `DATABASE_URL` temporarily supplied. Supabase already owns `auth.uid()`; hosted migrations do not replace it. The migrations are a standalone schema and must not be applied to an existing DayBook schema without an additive integration review.

Create a separate backend login with a strong password and grant it membership in `daybook_server`. Configure its connection URL in the application. The migration intentionally does not create a login or choose a password. The backend role must be able to `SET ROLE daybook_server`, but should not own tables or have `BYPASSRLS`. Do not deploy with the migration administrator's connection URL. Use TLS and the provider's pooler settings for hosted connections; never disable certificate verification to silence a connection error.

Browser roles `anon` and `authenticated` have no private-schema usage or mutation privileges. Owner-scoped reads have RLS; journal lines and lifecycle facts are append-only. Protected functions use an empty search path and schema-qualified references. Only the backend role can call the approved workflow entry points.

## Verification commands

```bash
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e -- --list
npm run eval
npm run eval -- --live
npm run preflight
```

`test:db` runs migrations, authorization and financial/API journeys against isolated in-memory PostgreSQL-engine databases. Three independent-session race tests are skipped unless both `TEST_DATABASE_URL` and `TEST_DATABASE_DEDICATED=true` are set. Those tests can initialize the schema and must only target a dedicated disposable database.

For actual browser tests, start the local app and run `E2E_BASE_URL=http://localhost:3000 npm run test:e2e`. Seven browser tests cover approval, refresh, edited-source invalidation, voice fallback, mobile layout, separate agent evidence, rejection and session isolation. They were collected but **not executed** in this environment after the browser policy blocked continued access. Do not interpret test collection as a browser pass.

The evaluation dataset contains 72 hand-labeled instructions, including 15 holdout cases, and 15 mocked voice reference scripts. Replay evaluation measures only eight exact fixture cases and labels the remaining 64 unrun. Live evaluation records all 72 as blocked without credentials; it never substitutes fixture output. There is no claimed live-model accuracy or STT score.

## Provider and cost boundaries

Gemini uses installed `@google/genai` structured output, a configured model ID, no hidden SDK retries, and server-side evidence/business validation. OpenAI fallback uses the installed Responses API SDK with `store:false`, no SDK retries, and the same source and schema. It is attempted only for an eligible transient Gemini failure, not refusal or unsupported facts, and consumes the same total call budget. Model IDs are recorded separately for each agent. No actual provider request was verified here.

Scribe uses `POST https://api.elevenlabs.io/v1/speech-to-text`, `model_id=scribe_v2`, multipart file, and server-only `xi-api-key`. Audio is not retained by DayBook; the returned transcription is owner-scoped. Provider retention policies still apply. Browser audio conversion and microphone behavior need actual HTTPS verification.

Langfuse uses pinned v6 packages and compatible OpenTelemetry v2 packages. Only manually named DayBook observations and allowlisted metadata are exported. Full source text, financial descriptions, raw audio, email addresses and credentials are not passed to tracing. Public trace success cannot prove a ledger commit. Actual export is blocked until credentials exist.

Default persisted budgets: 5 voice calls per owner per UTC day, 50 globally; 60 reserved model calls per owner/day, 600 globally; 45 seconds and 8 MiB per audio file; one leased transcription per owner. Worst-case model calls are reserved before a live run and unused reservations are not refunded. Resetting a workspace does not reset owner/global usage. These are application safeguards, not vendor free-tier quotas. Read the provider plans before deployment; $0 indefinitely is not promised.

## Deployment

See `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/THREATS.md`, `docs/DEMO.md` and `BUILD_EVIDENCE.md`. `vercel.json` uses the Next.js framework and 60-second agent/voice functions. Vercel Hobby eligibility, hosted database access, account quotas and provider terms must be checked for the actual account. No live deployment or public URL was created.

## Known limits

This is a personal-ledger prototype with synthetic demo records. It does not execute payments, synchronize banks, verify bank balances or establish regulatory compliance. Corrections support expense/income replacements; broader refund and dependency compensation workflows are blocked. Day close and explicit reopen preserve immutable snapshots and unresolved differences. Arbitrary target lookup filtering, token-usage accounting, rich report Q&A, real voice fixtures, a recorded walkthrough and actual provider evaluations remain incomplete. Unsupported operations must be clarified rather than reclassified into convenient financial kinds. Details and all T01–T36/A01–A24 statuses are in the checklist.
