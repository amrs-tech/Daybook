# Security and privacy boundaries

This document describes implemented controls and verification limits. It is not a production certification.

| Threat                               | Implemented control                                                                                               | Remaining verification                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Cross-owner guessing                 | Verified user identity, owner checks in protected functions, RLS on exposed data, inaccessible IDs return 404     | Hosted Auth, PostgREST grants and two deployed browser sessions |
| Model posts directly                 | No write tools; strict outputs; browser mutation grants revoked; backend-only commit function                     | Actual model injection evaluation                               |
| Invented amount/account              | Exact snippets for critical model fields, bigint parser, unique alias resolution, explicit form review            | Full live-model extraction benchmark                            |
| Double submit or lost response       | Immutable receipt, unique draft/key constraints, row locks and replay recovery                                    | Conventional PostgreSQL parallel-session tests                  |
| Stale review                         | Version/hash/revision binding; edits invalidate preview; 15-minute expiry                                         | Deployed multi-tab behavior                                     |
| Mutable financial history            | Append-only journal/lifecycle triggers, exact reversal uniqueness, source ancestry                                | Independent migration review on hosted project                  |
| Unbalanced/foreign journal           | Deferred balance constraints, composite workspace references, independent SQL action compilation                  | Hosted tests under final backend role                           |
| Prompt injection through source/tool | System/user separation, enum allowlist, exact evidence validation and conservative uncertainty guard              | 72-case actual model run, including holdout                     |
| CSRF                                 | Exact configured Origin, secure production HttpOnly SameSite Strict cookie, strict JSON/multipart                 | Exact deployed origin and HTTPS cookies                         |
| Upload resource abuse                | Streaming body cap, signature/PCM validation, byte-derived duration, owner/global quota, lease                    | Deployed request and platform payload limits                    |
| API spend abuse                      | No public signup endpoint, per-owner/global daily caps, graph/call budgets and disabled hidden SDK retries        | Real account quotas and provider billing behavior               |
| Secret/PII tracing                   | No content passed to tracing; allowlisted metadata, manual DayBook spans only; no raw provider exceptions in HTTP | Actual Langfuse exported-span inspection                        |
| Telemetry outage repeats posting     | Same business promise reused; independent exporter flush bounded and isolated                                     | Live outage smoke                                               |
| CSV spreadsheet formula              | Formula prefixes escaped and every cell quoted                                                                    | User spreadsheet application behavior                           |
| Reset erases audit trail             | Archive owned synthetic workspace; fresh IDs; immutable history retained                                          | Hosted reset journey                                            |

## Sensitive storage

DayBook discards uploaded audio after a request. Confirmed source, returned transcript and human field correction history are stored owner-scoped in the database and can contain financial/personal content. Database backups, encryption-at-rest and retention settings depend on the hosting provider and were not verified. No claim is made that Gemini free-tier or ElevenLabs processing is zero-retention or excluded from provider improvement. Use synthetic data only for a public demo.

Password sign-in forwards credentials to the configured Supabase Auth service. Access tokens are kept in server HttpOnly cookies and checked with the provider. Automatic refresh and account deletion UI are not implemented. The application does not have a public signup endpoint, browser service-role key or privileged user-controlled SQL endpoint.

## Operational cautions established by testing

The initial broad OpenTelemetry SDK dependency tree failed `npm audit`. It was removed and replaced by the compatible tracing-only provider. The final dependency audit result is recorded with the build evidence. No vulnerable dependency was silently forced through peer checks.

The local database is single-session serialized PGlite. It proves execution of SQL constraints and RLS in that engine, not network PostgreSQL locking under real simultaneous clients. Independent-session tests are supplied and skipped when access is absent.
