# DayBook v2.1 build evidence

**Status: local implementation complete enough for deterministic review; public release blocked.** No existing repository was provided. This is a new standalone implementation based only on the current chat's pasted instruction and v2.1 contract. It is not a certified upgrade of prior financial code.

## Implementation

Next.js/TypeScript workspace, separate bounded Planner/Writer nodes, strict source-evidence validation, deterministic bigint financial preview, owner-scoped persistent source/run/draft state, human approval, protected SQL commit, immutable balanced journals, claims/bills/reversals/corrections, day-close/reopen snapshots, audio recording/Scribe gateway, redacted Langfuse integration, exports, synthetic seed and archived reset are implemented. The README, architecture, deployment runbook, threats, demo narrative, fixtures and all acceptance-case statuses are included.

The authoritative Appendix C and D runtime prompts retain their source hashes, verified by `tests/unit/prompts.test.ts`. Prompt versions are `daybook-planner-v2.1` and `daybook-writer-v2.1`.

## Verification results

Final executed command results and exit statuses are recorded in `docs/evidence/verification-summary.json` and the adjacent logs. This report deliberately distinguishes unit, SQL-engine/API, fixture replay, real providers and actual browsers.

| Gate                      | Result                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| TypeScript                | See final verification summary; actual command `npm run typecheck`                                       |
| Deterministic unit suite  | See final unit report and exact count                                                                    |
| SQL-engine/API suite      | See final integration report; three conventional PostgreSQL races are skipped without access             |
| Production build          | Actual `npm run build`, with pinned dependencies; see final build log                                    |
| Browser test collection   | Seven Playwright tests supplied and collected; collection is not execution                               |
| Dependency audit          | Final `npm audit --omit=dev --json` reports zero known production vulnerabilities at run time            |
| Fixture replay evaluation | Eight known examples measured; 64 other labeled cases not run in replay mode; this is not model accuracy |
| Actual Gemini evaluation  | All 72 cases blocked by missing credentials/model ID; no live accuracy claimed                           |
| Voice references          | 15 mocked reference scripts supplied; no recordings or STT score                                         |

### What local SQL execution proves

Tests apply all migrations to isolated PGlite PostgreSQL WASM engines and execute actual SQL, deferred constraints, triggers, RLS, authenticated server-role functions and persistent business rows. They do not mock SQL or the ledger commit. They cover balanced golden results, shared receivables, two ₹200 settlements, over-settlement, pending/paid bills, reversal/replacement dependencies, duplicate receipts, stale versions, historical cash, closes/reopens, direct-write denial, owner isolation and atomic rollback. API scenarios call the real route handlers with synthetic authenticated sessions and verify canonical receipts/journal rows.

PGlite is serialized. Its tests do **not** prove independent PostgreSQL-session lock/concurrency behavior. Three opt-in tests using conventional `pg.Client` connections are included and skipped until a dedicated test database is available.

### Browser evidence and limit

The local preview rendered the sign-in workspace and was visually inspected. Its configuration endpoint returned local replay availability. During the first UI check, client navigation did not respond; the development bundler was changed, but the browser subsequently rejected continued access under its URL policy. No alternate browser surface was used to bypass that restriction. Full client hydration/interactivity, mobile layout, refresh, microphone permissions and deployed journeys remain unverified and may require debugging. Seven authored Playwright cases were collected only. No successful browser journey or demo video is claimed.

### Providers and telemetry

No Gemini, ElevenLabs, OpenAI, Langfuse or Supabase authentication request was verified live. No actual Gemini/OpenAI model ID was configured. The only executed agent model identifier is `deterministic-fixture-replay-v1`, explicitly labeled as fixture replay. Scribe is configured in code as the documented `scribe_v2` batch model, but has not returned a real transcript here. Langfuse has no verified exported trace reference.

Installed APIs were checked through official documentation and package declarations. The initial OpenTelemetry SDK dependency tree was rejected by audit; it was replaced with compatible tracing-only packages, then audited again. The final lockfile pins actual installed versions.

The final executed suite contains **124 passing tests, zero failures and three skipped PostgreSQL race tests**. Seven browser journeys remain unrun. A separate Node process reread the file-persisted synthetic posting; `docs/evidence/persistence-smoke.json` records the actual receipt-linked entry.

## Synthetic demonstration scenarios

| Scenario                           | Executed evidence                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: three expenses                  | Authenticated source → two fixture-agent nodes → missing-field block → explicit edits → preview → approval → three persisted entries → same receipt on replay |
| B: shared dinner and ₹500 returned | Two authorized operations; explicit personal share/accounts/date/new claim target; new claim balances ₹800 and ₹300; no new earned income                     |
| C: duplicate investigation         | Owner-scoped candidates, unresolved reversal target, zero automatic financial effects                                                                         |
| D: ambiguous ₹500 payment          | No guessed operation; clarification question; no financial effects                                                                                            |
| E: bypass/insert request           | Zero authorized economic actions and no protected mutation                                                                                                    |

These executions use synthetic fixture providers. They prove plumbing, review and ledger behavior for these fixtures; they do not prove live intent classification or speech recognition.

## Missing access and release gates

1. An existing DayBook repository, if this must be integrated as an upgrade. None was attached or found; tested unseen code cannot be preserved or certified.
2. Supabase project URL/publishable key, two existing synthetic Auth users, an administrator migration connection, and a restricted backend database login. Hosted RLS and auth must be tested using the final settings.
3. A dedicated conventional PostgreSQL test connection for the three independent-session races.
4. Gemini API key and verified accessible model ID. Optional OpenAI fallback requires explicit enablement and eligible credentials/model. Real model responses and the 72-case benchmark remain blocked.
5. ElevenLabs Scribe API access/credits and browser microphone access on HTTPS. Actual transcription, 15 reference recordings and end-to-end voice journeys remain blocked.
6. Langfuse project keys/region and an actual exported trace readback. Metadata redaction and flush must be inspected live.
7. Vercel account/project access, exact deployment origin and verification of account limits/eligibility. No public URL or external Git push exists.
8. Browser access to complete the authored desktop/mobile/refresh/isolation journeys and resolve any remaining client startup issue.

## Known functional limitations

Richer report Q&A, filtered transaction investigation, token-usage accounting, broader refund/compensation correction workflows, automatic authentication token refresh, account deletion/retention UI and a recorded walkthrough are not completed. Reversal of a settled dependent source is deliberately blocked pending a supported compensating workflow. Corrections support expense/income replacements. Unknown or unresolved facts must be clarified, not converted to a convenient expense/income.

The public release criteria are not met. No bank verification, real funds movement, accounting compliance, flawless behavior or live-provider accuracy is asserted.

## Source control

A local feature repository was initialized because no source repository existed. The delivered archive includes its local Git history and verification evidence. The final response records the actual resulting local commit SHA. No external repository credentials or existing remote were supplied.
