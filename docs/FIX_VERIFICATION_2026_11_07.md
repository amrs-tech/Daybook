# Fixes and verification — 7 November 2026

The reported code defects have been addressed. Automated checks pass. A user-reported physical microphone transcript preserved the amount, payment method and account; remaining microphone controls and deployed HTTPS/runtime checks are pending. No deployment or GitHub push was performed.

## Corrections

| Reported issue | Correction |
| --- | --- |
| Provider schema rejection | Gemini-compatible schema projection, while retaining original Zod structure and financial validation. |
| Unverified Planner hints/excerpts | Source-constrained quote choices and case-only re-anchoring. Unsupported non-authoritative hints become null. |
| Guessed accounts and payment rails | Unsupported critical values become null with required clarification; optional payment methods are omitted rather than inferred from an account. |
| Writer rejects query steps | Query-only runs do not call the Writer model. Mixed requests send mutation steps only, with original references preserved. |
| Amount/date formatting mismatch | Trusted money/date parsing for evidence and financial score equivalence; original literal score remains separately available. Numeric substring matches are rejected. |
| Missing amount/date/target and invalid precision | Explicit unresolved fields and review questions; no rounding, date invention or guessed target selection. |
| Split evidence | Every person/amount association is checked even when a broad quote contains all names and numbers. Swapped and ambiguous allocations require clarification. Comma-grouped and spoken amounts use the trusted money parser in both grounding and final validation. |
| Unsupported capabilities | Server-side guards reject external bank/trade execution and refund-as-income relabeling; balance overwrites and missing cash-count arguments require clarification. |
| 503/504 reliability | Verified stable gemini-3.1-flash-lite selected locally; smaller Writer input, 25-second requests, 50-second agent budget and at most one transient retry sharing the original three-call cap. |
| Unhelpful/opaque failures | Safe HTTP category retained in failed-run metadata; user-facing retry messages contain no raw provider URLs or secrets. |
| Optional metadata blocks review | Payment method, category and description questions do not override required financial checks. Unpaid bills do not require payment account or counterparty. |
| Browser timing and evaluation false-green | Browser waits for the actual commit response. Live evaluation now fails on applicable metric mismatches as well as exceptions. |

## Verification

- 108 unit tests passed.
- 50 integration tests passed, including all three independent PostgreSQL races; 0 skipped.
- 7 browser scenarios passed.
- 16 hosted Supabase/API/voice scenarios passed during this fix session.
- TypeScript and production build passed.
- Original-contract prompt hashes remain intact; execution policy v2.2 is separately versioned and recorded in run payloads/traces.

## AI verification stages — do not combine them into a single clean live run

1. Full 72-case stable-model run: 71 completed, 1 failed. The remaining split-evidence exception and four classification/clarification mismatches were then corrected. One HTTP 504 recovered through the bounded retry.
2. Live confirmation of E052, E054, E057, E062 and E070 after those corrections: 5/5 met all applicable metrics, zero exceptions.
3. Final-code regression using all 72 captured synthetic model outputs: 72/72 passed, no network requests. This verifies the final guards; it is not a new live-model accuracy measurement.
4. Separate fresh-phrasing live validation: 12/12 met all applicable metrics, zero exceptions. These phrasings were not used to tune the fixes.

The original 15 holdout cases were examined during debugging, so they are no longer an untouched holdout. Neither this finite dataset nor a successful test run guarantees correctness on every future instruction.

Financial critical-field equivalence passed 2/2 on the full run. Literal string equality remains separately reported as 0/2 where amounts differ only by wording, such as 2000 vs 2000 rupees. Expected labels were not changed.

## Remaining acceptance checks

- Human microphone: recording/transcription, Pause and Stop are confirmed by the user. The latest reported transcript preserves the stated sentence, including twenty-five rupees. The exact amount parser and semantic comparison both return ₹25.00. Cancel and permission denial remain unconfirmed.
- Deployed HTTPS, exact origin, platform function limits and browser microphone behavior must be checked on a deployment candidate.
- Cloud availability remains external. The app handles transient failures with a bounded retry and stops before approval/posting when required facts are missing.

## Local state

Stable model selected in ignored .env.local. Credentials remain excluded from Git. The hosted fix check posted an explicitly synthetic 11-rupee expense in the dedicated test project. No real funds moved. The app is available at http://localhost:3000 while its server runs.

## Evidence

See docs/evidence/fix-verification-2026-11-07.json and the linked evidence paths within it. Earlier diagnostics remain preserved, including the original 64-failure and subsequent 50-failure runs.

## Final split-allocation review

A final review found that a broad quote containing all people and amounts did not prove each allocation. The guard now checks each explicit person-to-amount association on every run. Both grounding and final contract validation share this guard. Swapped allocations require clarification; grouped numeric and spoken money are supported through the trusted parser. Three new regressions cover this behavior.

Live confirmation of E003, E004, E016, E017 and E062 after this last change: 5/5 passed all applicable metrics; 10 HTTP 200 responses, zero errors. The final 108-unit-test run, 50 integration tests, 72-case captured regression, typecheck and production build were rerun after this change. The earlier 7 browser and 16 hosted/API scenarios remain passed; no UI flow changed in this final guard correction.

## Physical microphone observations

The user confirmed that Pause and Stop work. Cancel and permission-denial behavior remain unconfirmed.

Latest user-reported original: “I spent 25 rupees for drinking tea yesterday”. Latest transcript: “I spent twenty-five rupees for drinking tea yesterday”. The meaning, completed-event wording, description and relative date are preserved. Writing an amount in words is acceptable and needs no correction. Direct checks of the exact production parser and semantic amount comparison passed: both amount forms represent 2500 integer paise (₹25.00).

The earlier reported transcript was “Spend ₹25 using cash from Cash Wallet for TestT today”. It differs from the requested test script, but the corresponding audio was not independently inspected; the script is not proof of what was actually spoken. Both observations remain recorded without replacing the earlier text.

These are user-reported observations, not an overall speech accuracy benchmark. Review the extracted transaction before approval. No ledger posting is inferred. Evidence: `docs/evidence/manual-microphone-2026-11-07.json`. No application code changed; prior automated test results remain unchanged.
