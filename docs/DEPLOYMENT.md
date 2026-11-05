# Deployment runbook

No deployment was performed. This is the concrete path to a Vercel and Supabase demo once access is available.

1. Create a dedicated empty Supabase demo project. Verify the actual account's free allocation, data processing terms, supported region and Auth settings. Create at least two synthetic test accounts. Public anonymous signup is deliberately absent from this build.
2. Read all migrations in order. Apply them using the migration administrator through `npm run db:migrate`, with `LOCAL_DEMO_ENABLED=false` and its admin connection supplied only for this command. Do not apply these standalone tables to an existing application's schema.
3. Create a restricted backend database login with a strong password, grant membership in `daybook_server`, and use that connection as the application `DATABASE_URL`. It must not own tables or have bypass-RLS privileges. Confirm the connection can `SET ROLE daybook_server` and execute only the intended private workflow functions. Use the provider's TLS/pooler settings.
4. Configure the Supabase URL and publishable key, actual Gemini credentials/model ID, ElevenLabs Scribe access and Langfuse region/keys. Keep all provider secrets out of `NEXT_PUBLIC_*`. Keep `LOCAL_DEMO_ENABLED=false` and remove `LOCAL_DATABASE_PATH`.
5. Use an actually supported Gemini model available to the account. Run `npm run preflight`; confirm a real schema-valid response. Fallback stays disabled unless explicitly eligible credentials/model are configured. Account quota and terms are not established by model documentation alone.
6. Check Vercel Hobby's personal/noncommercial eligibility for this specific demo. The checked official pages describe differing function ceilings depending on Fluid compute; this app uses 60 seconds, but verify the selected project's actual runtime and limits. Create a Next.js project, Node 22 or newer, and configure exact HTTPS `APP_ORIGIN` and server variables. Do not copy the local demo environment to production.
7. Push the reviewed source to the desired Git repository and configure the Vercel Git integration. No GitHub repository access was supplied in this session. Build with `npm ci` and `npm run build`; migrations are a separate reviewed step, not automatic production build work.
8. Run two authenticated browser sessions, inspect RLS with guessed workspace/draft IDs, and prove direct browser financial writes and private functions are denied. Verify source confirmation, both model nodes, form editing, version invalidation, duplicates, approval, refresh, canonical receipt reread and owner-scoped exports.
9. Run the opt-in PostgreSQL race suite against a separate dedicated database: set `TEST_DATABASE_URL` and `TEST_DATABASE_DEDICATED=true`, then `npm run test:db`. Verify at least 20 parallel approvals, competing stale drafts and competing bill payments using independent connections.
10. On the deployed HTTPS URL, allow the microphone intentionally, record a short synthetic script, Stop, choose Transcribe, edit the transcript, confirm, review, approve and check journal state. Exercise denial, cancel, pause, unsupported microphone formats, 45-second limit and provider failures. No actual browser microphone test passed here.
11. Verify a real exported Langfuse investigation with separate Planner/Writer children, actual model IDs, metadata redaction and commit correlation. Verify outage isolation. Record the actual trace reference only after export/readback succeeds.
12. Run the 72-case live evaluation, replace mocked voice scripts with at least 15 real labeled recordings, record STT amount/negation disagreements, preserve holdout status, and publish denominators with failures. A successful fixture replay is not an LLM score.

## Rollback and data preservation

Retain the exact pushed source commit and Vercel version for rollback. Roll back application code only after confirming its schema compatibility. Financial migrations and committed facts are not rolled back by deleting entries. Use explicit reviewed reversals or a compensating workflow. Demo reset archives its owned synthetic workspace and starts fresh IDs; it does not erase historical journals or reset owner/global quota counters.

## Official documentation checked during implementation

The following are references for API/configuration preflight, not proof of an account's entitlement or live availability. Checked on 2026-11-05.

- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) and installed `@google/genai` declarations for `responseJsonSchema`, abort and retry options.
- [ElevenLabs batch Scribe](https://elevenlabs.io/docs/api-reference/speech-to-text/convert). The request uses `file`, `model_id=scribe_v2` and `xi-api-key`. Account-dependent retention controls were not assumed.
- [LangGraph StateGraph](https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.StateGraph.html) and installed LangGraph 1.7 types.
- [Langfuse JS/TS overview](https://langfuse.com/docs/observability/sdk/overview), v6 and the installed package declarations.
- [OpenTelemetry NodeTracerProvider](https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_sdk-trace-node.NodeTracerProvider.html).
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [secure functions](https://supabase.com/docs/guides/database/functions).
- [Vercel Hobby](https://vercel.com/docs/plans/hobby) and [function limits with Fluid compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute).
- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), for the optional disabled-by-default fallback. The actual installed SDK types were compiled.

Check [ElevenLabs pricing](https://elevenlabs.io/pricing), [Langfuse pricing](https://langfuse.com/pricing), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and the selected account dashboards before enabling spend. Exact free-account balances and quotas were unavailable.
