# Deploy Daybook to Vercel and Supabase

Updated 7 November 2026 (India time). No live deployment has been created yet.

Use the existing Next.js project, GitHub repository `amrs-tech/Daybook`, and the dedicated Supabase project already configured for testing. The selected model remains `gemini-3.1-flash-lite` (stable).

The latest fixes are local and must be pushed before importing the repository. Local automated verification passed; HTTPS/runtime acceptance remains a deployment task. The latest live comparison was partial because both Google free-tier daily quotas were exhausted. See [fix verification](FIX_VERIFICATION_2026_11_07.md) and [model comparison](MODEL_COMPARISON_2026_11_07.md).

## 1. Publish the reviewed source to your repository

Open PowerShell in `E:\experiments\daybook-agent-v21`:

```powershell
Set-Location -LiteralPath 'E:\experiments\daybook-agent-v21'
git config --get user.name
git status --short
node .local/verify-secrets.cjs
```

The Git author is configured as `amrs-tech`. When Git requests GitHub authentication, use your `amrs-tech` account; the author name and login are separate settings. GitHub CLI is not installed and is not required for this workflow. The secret scan must show an empty `localSecretMatches` array. The scan helper is ignored and remains local.

Then publish:

```powershell
git add .
git diff --cached --stat
git diff --cached --check
git ls-files .env.local .env.verification-admin.local
git commit -m "Fix agent validation and prepare verified deployment"
git push origin main
```

The `git ls-files` command must return no environment files. Do not force-add ignored files. Do not commit `.env.local`, `.env.verification-admin.local`, `.local`, API keys, database passwords or test login credentials.

The application and lockfile pin Node to `22.x`, matching the final local verification runtime. Vercel lets `package.json` engines override the dashboard, so a broad `>=22` range would allow a newer, untested runtime.

## 2. Prepare the hosted database connection

Keep the existing dedicated Supabase project and its applied migrations and `daybook_backend` role. Do not recreate the project or rerun migrations just to deploy the frontend/server.

The current local connection is direct. For the serverless deployment, open Supabase → **Connect → Transaction pooler** and copy its actual host and connection format. Use the restricted backend role, not the administrator:

```text
postgresql://daybook_backend.PROJECT_REF:URL_ENCODED_ROLE_PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
```

Replace the placeholders locally using the connection details shown by your own project. The password is the `daybook_backend` role password, which can differ from the project administrator password. URL-encode password characters once: for example, `@` becomes `%40`. Do not encode the whole URL or paste the password into chat.

This app uses parameterized, unnamed `pg` queries and transaction-local role/owner settings, rather than named prepared statements or session-persistent identity. That matches transaction pooling. Keep migrations on an administrator direct/session connection, outside Vercel builds.

If you create a different Supabase project, it needs the migrations, restricted role and confirmed Auth users set up separately before the app can use it.

## 3. Import the GitHub repository into Vercel

1. Open [Vercel New Project](https://vercel.com/new) and sign in through your GitHub account.
2. Import `amrs-tech/Daybook`. Grant Vercel access to this repository if it is not listed.
3. Use the settings below.

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root directory | Repository root (`./`) |
| Production branch | `main` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | Framework default; do not set `out` |
| Node.js | `22.x` |

The existing `vercel.json` and route exports configure 60-second agent and voice functions. Use a Vercel plan supporting that duration; current Hobby supports it. Hobby is for personal, non-commercial use. For commercial use, select an eligible paid plan.

Where available, choose a function region near your Supabase project's region. Do not add a static-export build: the app needs server-side routes, authentication and PostgreSQL.

## 4. Add production environment variables

In Vercel's project import form or **Settings → Environment Variables**, add values for **Production**. Copy existing secrets directly from the ignored local file into Vercel. Do not upload the whole file or copy its localhost origin.

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Restricted transaction-pooler URL from step 2 |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing publishable/anon key, not a service-role secret |
| `GEMINI_API_KEY` | Existing Gemini key |
| `GEMINI_MODEL_ID` | `gemini-3.1-flash-lite` |
| `ELEVENLABS_API_KEY` | Existing ElevenLabs key |
| `LANGFUSE_PUBLIC_KEY` | Existing Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Existing Langfuse project secret key |
| `LANGFUSE_BASE_URL` | Existing Langfuse region/base URL |
| `LANGFUSE_CAPTURE_CONTENT` | `false` |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `LOCAL_DEMO_ENABLED` | `false` |
| `OPENAI_FALLBACK_ENABLED` | `false` |
| `DEMO_MODE_ENABLED` | `true` for this first hosted test deployment |
| `APP_ORIGIN` | Add the actual stable HTTPS production domain in step 5 |

Do not add `LOCAL_DATABASE_PATH`, `LOCAL_SESSION_SECRET`, `TEST_DATABASE_URL`, `TEST_DATABASE_DEDICATED`, `TEST_USER_*`, administrator database credentials or `SUPABASE_ADMIN_KEY`. OpenAI keys/model variables are unnecessary while fallback is disabled. Vercel sets `NODE_ENV=production`; do not override it.

The runtime explicitly selects ElevenLabs `scribe_v2`; its model setting is not controlled by the example environment variable. Likewise, the current audio limits are code constants: 45 seconds and 8 MiB. Vercel's request-body limit is 4.5 MB, so use the built-in 16 kHz mono recorder: 45 seconds of its PCM audio is about 1.44 MB before small multipart overhead. An 8 MiB custom upload will not pass Vercel's smaller platform limit.

Keep production secrets scoped to Production for now. Preview deployments use different origins and should have a separate test database/origin configuration before they are used for financial tests.

## 5. Deploy, then set the exact stable origin

1. Click **Deploy** and wait for a successful build.
2. Open **Settings → Domains** and copy the stable project production domain, such as `https://your-daybook-project.vercel.app`. This is an example, not a reserved or deployed domain.
3. Set `APP_ORIGIN` to that exact HTTPS origin, without a path. Do not use `localhost`, a wildcard, or a unique deployment-hash URL.
4. Save, then **Redeploy** the latest production deployment. Environment changes apply to a new deployment.
5. Open the stable domain. Use that domain for all subsequent tests.

The first build can complete before `APP_ORIGIN` is known. Do not try login or other mutations until it is set and the redeployment finishes: exact-origin validation will reject them. Only the one configured origin is accepted, so alternate Vercel hostnames are not interchangeable with it.

The model configuration stays `gemini-3.1-flash-lite`; no local model change is needed.

## 6. Update Supabase Auth

1. Open the existing Supabase project → **Authentication → URL Configuration**.
2. Set **Site URL** to the same stable production HTTPS origin.
3. Add that exact URL to the redirect allow list. Keep `http://localhost:3000` only if you still need local authentication-related emails or development.
4. Keep Email/password sign-in enabled and the two existing test users confirmed.
5. For this personal/invite-only deployment, disable **Allow new users to sign up**. Existing users can still sign in. Add intended users through the Supabase administrator interface.

The app currently uses email/password login and has no OAuth/magic-link callback or public signup UI. Do not invent an `/auth/callback` redirect route. Site URL matters for Supabase-generated email links; setting it does not implement an app password-reset flow.

## 7. Verify the deployment before sharing it

1. Visit `<your-origin>/api/config`. Expect `data.authConfigured=true` and `data.localDemoAvailable=false`. This checks configuration presence only; it is not a database or provider health test.
2. Sign in with test user A; confirm the ledger loads. Sign out and use test user B in a separate browser profile; confirm its workspace differs.
3. After Gemini quota is available, type `I spent 25 rupees from Cash wallet for tea today.` Confirm and interpret; verify ₹25, today's date, the correct account and an editable expense draft.
4. Explicitly review and approve this synthetic test once. Refresh and verify the same receipt/journal entry persists; do not approve a real financial transaction just to test.
5. Record/transcribe a short phrase on HTTPS. Confirm the amount and exercise Pause, Stop, Cancel and microphone denial. Local Pause/Stop were user-confirmed; hosted behavior and Cancel/denial still need acceptance.
6. Verify exports, owner isolation and Langfuse metadata-only traces. Use Vercel function logs to diagnose failures without copying secrets into chat.

The last Google response identified a 500-request daily free-tier limit for Lite and indicated reset around **1:30 p.m. IST on 7 November 2026**. That is an estimate from the provider's retry guidance, not a guarantee. Deployment can proceed before the reset, but successful AI interpretation cannot be verified while the same project quota is exhausted. Enable billing only if you choose to; this guide does not enable it or change the API project.

`DEMO_MODE_ENABLED=true` uses synthetic demo records. Reusing the test project also preserves earlier test entries. Setting it to `false` only prevents automatic seeding; it does not remove existing records or create a separate clean real-data system. Treat this first URL as a hosted test deployment.

## Common deployment failures

| Symptom | Check |
| --- | --- |
| Login/mutation returns `INVALID_ORIGIN` | Open the stable production domain, match `APP_ORIGIN` exactly and redeploy after changing it |
| Database unavailable | Pooler hostname/port, restricted-role password, URL encoding, TLS and project availability |
| Login fails | Same Supabase project URL/key, confirmed test user, Email/password enabled |
| AI quota error / HTTP 429 | Google AI Studio project's RPM/RPD; a deployment does not reset provider quota |
| Voice HTTP 413 | Vercel's 4.5 MB body cap; use the built-in recorder |
| Build uses the wrong Node version | Confirm the pushed `package.json` and lockfile both pin `22.x` |
| Latest fixes missing | Confirm Vercel deployed the new GitHub commit on `main`, not the earlier setup commit |

## Subsequent updates, custom domain and rollback

Push approved code updates to `main` to trigger new production builds. When adding a custom domain, verify it in Vercel and update both `APP_ORIGIN` and Supabase Site URL/allow list, then redeploy and test on the new canonical domain.

Keep the deployed commit ID. Roll back compatible application code through Vercel if needed. Application rollback does not undo database migrations or delete financial journal records. Do not reset the database to fix an application deployment.

## Sources checked for this guide

- [Vercel Node versions and package overrides](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel environment variables and redeployment](https://vercel.com/docs/environment-variables)
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel function payload limits](https://vercel.com/docs/functions/limitations)
- [Vercel Hobby eligibility](https://vercel.com/docs/plans/hobby)
- [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase transaction-pooler prepared statement settings](https://supabase.com/kb/troubleshooting/disabling-prepared-statements-qL8lEL)
- [Supabase Auth URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
