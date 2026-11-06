# Windows setup and live deployment

Project: E:\experiments\daybook-agent-v21
Prepared: 6 November 2026. The original ZIP is unchanged.

## 1. Open and run the prepared demo

In PowerShell:

```powershell
Set-Location 'E:\experiments\daybook-agent-v21'
npm run dev
```

Open http://localhost:3000 and choose Explore local demo. Stop with Ctrl+C before migrations, standalone persistence checks or production builds. Exact fixture examples work without keys; arbitrary text needs Gemini. Node 22.22.2 is installed and satisfies the project requirement.

## 2. Add provider keys locally

Edit E:\experiments\daybook-agent-v21\.env.local in your editor. Preserve the generated LOCAL_SESSION_SECRET and existing local settings. The fields below are already present; fill the blanks in place (avoid duplicate names):

```dotenv
APP_TIMEZONE=Asia/Kolkata
GEMINI_API_KEY=
GEMINI_MODEL_ID=
ELEVENLABS_API_KEY=
ELEVENLABS_STT_MODEL_ID=scribe_v2
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_CAPTURE_CONTENT=false
OPENAI_FALLBACK_ENABLED=false
```

- Gemini: create a key at https://aistudio.google.com/api-keys and select a model available to your account that supports structured JSON output. Put its exact API model identifier in GEMINI_MODEL_ID. Do not guess an identifier. Reference: https://ai.google.dev/gemini-api/docs/api-key
- ElevenLabs: create an API key with speech-to-text access. Reference: https://elevenlabs.io/docs/api-reference/authentication . This app uses batch Scribe, not a text-to-speech voice ID.
- Langfuse: create a project and copy both project keys from its settings. Match the project region: EU https://cloud.langfuse.com, US https://us.cloud.langfuse.com, Japan https://jp.cloud.langfuse.com. Use the base origin, without /api/public. Reference: https://langfuse.com/docs/api-and-data-platform/features/public-api
- Optional OpenAI fallback is unnecessary for initial verification; leave disabled.

The existing local authentication/database settings may remain enabled while testing real model and voice providers locally. Configured Gemini credentials select the live provider automatically. Restart the app after edits. Keep secrets in the ignored .env.local file; do not paste them in chat or add them to Git.

Run npm run preflight to test Gemini structured output. Its other provider results remain blocked until actual workflows are exercised; key presence alone is not a successful verification.

## 3. Configure hosted authentication and database

Create a NEW dedicated Supabase demo project. In its Authentication user management, create two confirmed synthetic email/password test users. This app signs in existing users; it has no signup flow. Keep their credentials available locally for the later two-user browser checks.

Get the project URL and publishable/anon key from Supabase. Add these to .env.local:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Use the Supabase Connect dialog for connection strings and TLS/pooler settings: https://supabase.com/docs/guides/database/connecting-to-postgres . URL-encode special characters in database passwords. A service-role API key is not needed.

Before migrating the hosted database, change LOCAL_DEMO_ENABLED=false and clear LOCAL_DATABASE_PATH. Leave APP_ORIGIN=http://localhost:3000 for local testing. Otherwise the migration script selects the local database instead of the hosted one.

Supply the ADMIN database connection only temporarily in PowerShell (replace the placeholder locally):

```powershell
$env:DATABASE_URL = 'ADMIN_CONNECTION_FROM_SUPABASE'
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

Proceed only if migrations finish successfully. In Supabase SQL Editor, create a separate application login using your own strong password:

```sql
CREATE ROLE daybook_backend LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT daybook_server TO daybook_backend;
```

Set DATABASE_URL in .env.local to the connection for this restricted login, NOT postgres/admin. For a shared Supabase pooler, the username typically includes the project reference (daybook_backend.PROJECT_REF); confirm the correct host, username, port and SSL parameters for that project. Test the restricted connection can SET ROLE daybook_server. Do not disable TLS certificate verification.

Now npm run dev uses hosted Auth and PostgreSQL, and real providers when configured. Sign in with each synthetic account in separate browser sessions.

## 4. What is needed for complete verification

After adding keys, tell the assistant that local configuration is ready. Do not send secret values. Keep two synthetic user logins available through a local ignored file or enter them yourself when needed. Live provider calls consume account quota.

Checks to run:

```powershell
npm run typecheck
npm test
npm run test:db
npm run preflight
npm run eval
npm run eval -- --live
npm run build
```

The independent-connection race tests need a SECOND dedicated disposable PostgreSQL database with migration/admin privileges. Do not target your live app database. These tests can initialize tables and auth helpers. The Vitest command does not load .env.local automatically; set test variables in the same terminal:

```powershell
$env:TEST_DATABASE_URL = 'DISPOSABLE_TEST_DATABASE_ADMIN_CONNECTION'
$env:TEST_DATABASE_DEDICATED = 'true'
npm run test:db
Remove-Item Env:TEST_DATABASE_URL
Remove-Item Env:TEST_DATABASE_DEDICATED
```

The bundled seven Playwright tests target the LOCAL REPLAY flow. Run them against the local demo configuration and a running development server, not hosted production authentication:

```powershell
npx playwright install chromium
$env:E2E_BASE_URL = 'http://localhost:3000'
npm run test:e2e
```

Separately verify hosted login, two-user isolation, real Planner/Writer results, edit/preview/approve/post, refresh persistence, exports, failed/duplicate/stale approvals, and actual Langfuse trace readback. Real microphone checks need synthetic recordings with known amounts/negations, plus permission denial, cancel/pause, time and size limits. Repeat microphone and auth flows on deployed HTTPS. Passing replay tests does not verify live AI or speech accuracy. The source README records remaining prototype limitations.

## 5. Deploy live to Vercel

1. Finish local/provider/hosted checks first. Push the reviewed source to a repository you control. The archive includes Git history; inspect Git status and remotes before pushing. Never push .env.local or .local.
2. Import the repository into Vercel with this folder as project root, Next.js preset, Node 22 or newer, install command npm ci and build command npm run build. Keep the framework's default output directory. Migrations are separate, not a build command.
3. Set Vercel environment variables: restricted DATABASE_URL, Supabase URL/key, Gemini key/model, ElevenLabs key/model, Langfuse keys/base URL, APP_TIMEZONE=Asia/Kolkata, LANGFUSE_CAPTURE_CONTENT=false, DEMO_MODE_ENABLED=true and OPENAI_FALLBACK_ENABLED=false. Set LOCAL_DEMO_ENABLED=false. Omit LOCAL_DATABASE_PATH and LOCAL_SESSION_SECRET.
4. Set APP_ORIGIN to the exact stable HTTPS origin you will open, such as https://your-project.vercel.app (no path). Reserve/copy the project's domain first, then redeploy with the final value. Arbitrary preview domains require their own matching APP_ORIGIN.
5. Set variables for the intended Vercel environment before building; NEXT_PUBLIC variables are included at build time. Redeploy after changes. Reference: https://vercel.com/docs/environment-variables and https://nextjs.org/docs/app/guides/environment-variables
6. Deploy, then verify real sign-in, isolation, posting, readback, voice and traces on that URL. The included vercel.json sets 60-second agent/voice function duration; confirm your account supports it. Account quotas and plan eligibility must be checked in the actual dashboard.
7. Keep the source commit and deployment version for rollback. Roll back compatible application code; do not delete committed ledger facts or reverse SQL migrations casually.

No live deployment has been created by this setup. Public release remains conditional on real-provider and hosted verification.

