# DayBook v2.1 implementation and verification checklist

Only this chat and its attached standalone v2.1 contract were used. The initial workspace had no application or tests. “Verified local” refers to newly executed deterministic tests and PostgreSQL WASM-engine checks. It does not certify an unseen old repository, a live model or a hosted release.

| Phase                | Contract sections       | Status                                                                                                                                    |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline             | 0, 3, Appendix A        | Empty workspace audit verified in docs/BASELINE.md                                                                                        |
| Financial foundation | 4, 5, Appendix A        | Implemented and locally tested: exact paise, balanced journal, ownership, claims/bills/corrections, review, idempotency and close history |
| Planner and Writer   | 6–8, 10, Appendices B–D | Implemented; distinct schema/prompt/invocation; verbatim prompt hashes and mock regressions verified; actual model blocked                |
| Voice                | 9, Appendix F           | Recorder/gateway implemented; server audio/failure tests verified; actual microphone/Scribe blocked                                       |
| Observability        | 12–15                   | Metadata-only tracing and outage isolation implemented/tested; live export blocked                                                        |
| Evaluation           | 15                      | 72 labeled cases, 15 holdout, 15 mocked voice scripts; fixture replay measured; actual model/STT metrics blocked                          |
| Interface            | 10, 17, 20              | Responsive forms, review, timeline and history implemented; first preview rendered; full browser behavior unverified                      |
| Release              | 18, 21                  | Production build and deployment preparation implemented; public release BLOCKED by external access and browser gates                      |

## Financial acceptance matrix

| ID  | Status         | Evidence and remaining scope                                                                                                     |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| T01 | Verified local | golden.test.ts: explicit five-group narrative, six actions and exact canonical values; new fixture derived from contract amounts |
| T02 | Verified local | Asset-to-asset transfer; spending/income unchanged                                                                               |
| T03 | Verified local | Personal share plus exact receivable allocation equals payment                                                                   |
| T04 | Verified local | New ₹400 claim; ₹200 then ₹200 leaves ₹200 then zero; no income                                                                  |
| T05 | Verified local | Over-settlement cannot post                                                                                                      |
| T06 | Verified local | Two Arun claims returned; explicit target required; no first-match settlement                                                    |
| T07 | Verified local | Unpaid bill creates no journal; payment creates linked expense                                                                   |
| T08 | Partial        | Duplicate payment rejection verified; independent PostgreSQL race supplied but skipped                                           |
| T09 | Verified local | Exact reversal/replacement; old history remains; repeat reversal blocked                                                         |
| T10 | Verified local | Canonical settlement dependency blocks shared-payment reversal                                                                   |
| T11 | Verified local | Undo receipt reopens claim; undo bill payment reopens bill                                                                       |
| T12 | Verified local | Same approval replay returns original receipt                                                                                    |
| T13 | Verified local | Same key/different draft or payload conflicts                                                                                    |
| T14 | Verified local | Changed keys cannot post the same draft again                                                                                    |
| T15 | Partial        | Stale competing drafts conflict locally; independent-session race skipped                                                        |
| T16 | Verified local | Unsupported money, unresolved account and missing settlement target block                                                        |
| T17 | Verified local | Explicit default changes increment revision and invalidate stale preview                                                         |
| T18 | Verified local | Kolkata midnight parser; successor source retains immutable reference instant                                                    |
| T19 | Verified local | Invalid/future/pre-opening dates blocked by parser; SQL rechecks booked dates                                                    |
| T20 | Verified local | Historical negative cash blocks despite later compensating income                                                                |
| T21 | Verified local | Zero cash observation retains exact difference, no financial entry                                                               |
| T22 | Verified local | Immutable close, explicit reopen, reviewed backdate and new snapshot; original retained                                          |
| T23 | Partial        | Canonical account conventions exclude transfer/opening/repayment from income/spending; richer report Q&A deferred                |
| T24 | Verified local | Negation/hypothetical/uncertain-source guards; actual model behavior unmeasured                                                  |
| T25 | Verified local | Browser writes/private functions denied; deferred balance constraint rejects malformed privileged write                          |
| T26 | Partial        | Distinct-owner RLS/RPC/routes/exports tested; hosted Supabase Auth/PostgREST unverified                                          |
| T27 | Partial        | Eligible fallback/source/model attribution tested with mocks; real provider verification blocked                                 |
| T28 | Verified local | Both mocked models failing yields no fabricated draft/post                                                                       |
| T29 | Verified local | Tool/step boundaries and injection fixture block posting bypass; live red-team run blocked                                       |
| T30 | Verified local | Canonical JSON, exact money, formula-safe quoted CSV; no sessions or provider secrets                                            |
| T31 | Partial        | Stored committed status/receipt reread passes; browser refresh test collected but unrun                                          |
| T32 | Verified local | Equal purchase warning can be explicitly acknowledged as separate event                                                          |
| T33 | Verified local | Exact paise/word grammar/precision/range tests; no floating-point posting                                                        |
| T34 | Partial        | Query step produces no Writer mutation; preview label is explicit; actual report answering deferred                              |
| T35 | Verified local | Close retains unresolved counted-cash difference; no invented balancing expense                                                  |
| T36 | Blocked        | Actual Scribe/HTTPS microphone/edit/review/post/correction needs credentials and browser access                                  |

## Upgrade acceptance matrix

| ID  | Status         | Evidence and remaining scope                                                                       |
| --- | -------------- | -------------------------------------------------------------------------------------------------- |
| A01 | Verified local | Single typed expense through source/plan/preview/approval/receipt handlers                         |
| A02 | Blocked        | Real recording and actual Scribe response not run                                                  |
| A03 | Verified local | Scenario A: three actions, unresolved until edits/review, three entries atomically                 |
| A04 | Verified local | Plausible model output cannot turn negation into a completed write                                 |
| A05 | Verified local | Hypothetical/uncertainty guard blocks completed action                                             |
| A06 | Verified local | Bill planning versus payment lifecycle                                                             |
| A07 | Verified local | Transfer has asset sides only                                                                      |
| A08 | Verified local | Shared expense exact allocation                                                                    |
| A09 | Verified local | Partial repayment reduces claim; no income/over-settlement                                         |
| A10 | Verified local | Duplicate candidates and warnings; no automatic reversal                                           |
| A11 | Verified local | Duplicate seed candidates require exact target selection                                           |
| A12 | Partial        | Ambiguous grammar blocks; editable correction implemented; actual misspoken audio unmeasured       |
| A13 | Verified local | Missing account blocks normalization and approval                                                  |
| A14 | Verified local | Fixed reference timestamp and local-date arithmetic                                                |
| A15 | Verified local | Direct insert/skip-approval fixture produces no financial action                                   |
| A16 | Verified local | Extra Writer step/kind and invalid Planner references rejected                                     |
| A17 | Verified local | Unknown properties fail strict schema; one structural repair maximum                               |
| A18 | Partial        | Malformed output/provider-failure plumbing tested; actual Gemini timeout unverified                |
| A19 | Partial        | Audio/parser/provider failures tested; typed fallback UI implemented; mic permission journey unrun |
| A20 | Verified local | Exporter outage injected during actual synthetic DB posting; canonical state/receipt correct       |
| A21 | Verified local | Twenty repeated approvals return one receipt; true simultaneous-session version skipped            |
| A22 | Partial        | Two-owner RLS and guessed-ID isolation pass; real Supabase browsers/PG concurrency blocked         |
| A23 | Partial        | Persisted receipt/status and replay recovery verified; browser refresh unverified                  |
| A24 | Verified local | Rejected/unresolved batches have no financial effects                                              |

## Remaining gates and deferred work

- Actual hosted authentication and grants under the final backend login; conventional PostgreSQL independent-session races; deployed HTTPS browser journeys.
- Actual Gemini/eligible OpenAI responses, Scribe recordings, and an exported and retrieved Langfuse trace.
- Full 72-case live evaluation and 15 real recordings; token usage, unsupported-assumption and STT metrics.
- Rich report Q&A, finer lookup filtering, broader correction/refund compensation, account deletion/retention UI.
- Public deployment, external Git push and recorded walkthrough.

Every partial/blocked row remains a release limit. BUILD_EVIDENCE.md records commands, counts and concrete missing access.
