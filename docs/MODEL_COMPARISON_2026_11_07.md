# Daybook: 72-case Gemini model comparison — 7 November 2026

**PARTIAL COMPARISON — daily quota stopped both runs. Only 11 common cases were successfully evaluated by both models. The user chose this partial report rather than enabling paid billing.**

**The app remains on gemini-3.1-flash-lite. No deployment, model switch or ledger posting was performed.**

The requested gemini-3.5-flash endpoint actually returned gemini-3.6-flash. Google now documents automatic routing to 3.6. This comparison measures that endpoint as served today, not the historical native 3.5 model. The earlier 3.5 price comparison was based on an older indexed table and is superseded here.

| Metric | Current 3.1 Flash Lite | Requested 3.5 Flash → served 3.6 |
| --- | --- | --- |
| Requested model | gemini-3.1-flash-lite | gemini-3.5-flash |
| Served model | gemini-3.1-flash-lite | gemini-3.6-flash |
| Cases passing all checks / 72 scheduled (coverage, not accuracy) | 32/72 (44.4%) | 11/72 (15.3%) |
| Validated completions | 32 | 11 |
| Exceptions | 3 | 3 |
| Measured metric mismatches | 0 | 0 |
| Blocked without request | 37 | 58 |
| Operation-correct cases / 72 scheduled (coverage, not accuracy) | 32/72 (44.4%) | 11/72 (15.3%) |
| Operation sequence / validated cases | 32/32 (100.0%) | 11/11 (100.0%) |
| Critical fields, semantic / applicable completions | 2/2 (100.0%) | 2/2 (100.0%) |
| Critical fields, literal / applicable completions | 0/2 (0.0%) | 2/2 (100.0%) |
| Required clarification found / scheduled required cases (coverage) | 10/29 (34.5%) | 5/29 (17.2%) |
| Required clarification / validated required cases | 10/10 (100.0%) | 5/5 (100.0%) |
| Mean latency, validated completions | 5.05 s | 14.43 s |
| Median latency, validated completions | 3.85 s | 13.23 s |
| P95 latency, validated completions | 14.81 s | 33.15 s |
| Mean latency, all attempted cases | 4.69 s | 11.95 s |
| Wall time including cooldowns | 5.41 min | 4.83 min |
| Model invocations | 63 | 24 |
| HTTP 429 | 3 | 3 |
| HTTP 503/504 | 0 | 0 |
| Structural repair invocations | 0 | 0 |
| Prompt tokens (includes cache) | 106,737 | 36,271 |
| Cached prompt tokens | 40,855 | 1,535 |
| Visible output tokens | 15,057 | 3,875 |
| Thinking tokens | 0 | 27,078 |
| Reported-usage paid-tier equivalent | $0.04008 | $0.14224 |
| Without cache discounts | $0.04927 | $0.14328 |
| Equivalent per 1,000 submitted cases | $1.14507 | $10.16006 |
| Equivalent per 1,000 applicable passes | $1.25242 | $12.93099 |
| Attempts without usage metadata | 3 | 3 |
| Unexpected-clarification flags (diagnostic) | 2 | 0 |

## Paired comparisons

Both models passed all applicable checks in 11 common cases. On those identical passing cases, mean latency was 7.77 s for Lite and 14.43 s for Flash. Paid-equivalent usage cost on those cases was $0.01442 vs $0.13695.

Lite-only passes: E008, E013, E014, E016, E017, E018, E019, E020, E021, E022, E023, E024, E025, E027, E028, E029, E030, E031, E032, E033, E034. Flash-only passes: none. Neither passed: E015, E026, E035, E036, E037, E038, E039, E040, E041, E042, E043, E044, E045, E046, E047, E048, E049, E050, E051, E052, E053, E054, E055, E056, E057, E058, E059, E060, E061, E062, E063, E064, E065, E066, E067, E068, E069, E070, E071, E072.

## Interpretation

No accuracy winner is established by this partial sample. The requested Flash endpoint was slower and more expensive on the same 11 passing cases. Keep the existing app model unchanged. The 72-case denominators below describe scheduled coverage, not accuracy: blocked cases have unknown model outcomes. Conditional operation accuracy is 32/32 for Lite and 11/11 for Flash; semantic critical-field checks pass 2/2 for each. Flash preserves the expected literal field wording in those two cases while Lite uses equivalent wording, so Lite scores 0/2 literally despite correct financial values. This is formatting, not an amount error.

Lite attempted 35 cases: 32 validated, 3 quota exceptions, 37 subsequent cases blocked without requests. Flash attempted 14 cases: 11 validated, 3 quota exceptions, 58 subsequent cases blocked. The full 72-case comparison has not been executed. No provider 5xx, transport timeout, semantic mismatch or validation exception was observed in these attempted cases; all six failures were HTTP 429.

The Flash daily limit was reported as 20 requests and its minute limit as 5 requests. Lite reported 500 daily and 15 per minute. The Lite daily counter includes prior project usage, including earlier tests; this fresh run did not itself consume 500 requests. Most mutation cases need two model calls, so requests are not the same as test cases. Creating another key in the same project does not reset project quota.

Lite showed two extra-clarification flags: E022 asked who the electricity-bill counterparty was, and E023 asked for an account and internet service provider. These are optional metadata for unpaid bills; existing preview validation does not require these fields. They are diagnostic prompts, not scored financial failures. Flash was blocked before E022/E023, so this is not evidence that Flash handles those cases better. Neither model raised extra-clarification flags within the 11 common passing cases.

## Method

Same 72 fixture cases, expected labels, code hashes, fixed reference instant, accounts/contacts and execution policy daybook-execution-v2.2. Temperature 0, maxOutputTokens 8192, provider-default thinking, no tools or fallback, 25-second request timeout and 50-second total agent budget. A maximum of three model invocations includes structural repair and at most one transient retry. One sequential case per model, two independent processes running concurrently. Minimum 5-second case-start interval; HTTP 429 enforces at least 60 seconds of cooldown. No automatic case retries or result replacement. No persistent ledger writes.

Per-case latency includes model calls, grounding, validation and internal repair/retry; it excludes inter-case pacing/cooldowns. Wall time includes them. The paired speed comparison uses identical cases that passed for both models.

## Cost and quota

Current standard paid-equivalent text rates per million tokens: Lite $0.25 input / $0.025 cached input / $1.50 output including thinking. Served 3.6 Flash $0.75 input / $0.075 cached input / $3.75 output including thinking through 31 December 2026; scheduled 2027 rates are $1.50 / $0.15 / $7.50. These supersede the earlier native-3.5 rates for this endpoint.

Cost = (uncached prompt × input rate + cached prompt × cache rate + visible output and thinking × output rate) / 1,000,000. It includes all reported model-response usage, including invalid or failed cases and repairs. No explicit caches, paid search, audio, storage or tools were created. Unknown usage on failed/time-out responses cannot be invoiced accurately from client evidence. Per-1,000 amounts are workload extrapolations, not bills. Quota messages identify Free Tier; no account billing invoice was accessed.

Observed quota for gemini-3.1-flash-lite: GenerateRequestsPerMinutePerProjectPerModel-FreeTier = 15 (quota model gemini-3.1-flash-lite); GenerateRequestsPerDayPerProjectPerModel-FreeTier = 500 (quota model gemini-3.1-flash-lite).

Observed quota for gemini-3.5-flash: GenerateRequestsPerMinutePerProjectPerModel-FreeTier = 5 (quota model gemini-3.6-flash); GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20 (quota model gemini-3.6-flash).

## Failures and metric mismatches

### gemini-3.1-flash-lite

Blocked without model requests after daily quota: E036, E037, E038, E039, E040, E041, E042, E043, E044, E045, E046, E047, E048, E049, E050, E051, E052, E053, E054, E055, E056, E057, E058, E059, E060, E061, E062, E063, E064, E065, E066, E067, E068, E069, E070, E071, E072. These have unknown accuracy, not demonstrated model failures.

- **E015 — failed**: Withdrawn 2000 rupees from Everyday bank into Cash wallet today.
  - Expected operations: ["transfer"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 15 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"15","model":"gemini-3.1-flash-lite","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.1-flash-lite, description: Generate content requests per minute limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 15.282195287s.

- **E026 — failed**: Correct yesterday's fuel record from 1200 to 1000 rupees.
  - Expected operations: ["correct"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 24 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"15","model":"gemini-3.1-flash-lite","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.1-flash-lite, description: Generate content requests per minute limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 24.615341102s.

- **E035 — failed**: Today I moved 1000 rupees from Everyday bank to Cash wallet and spent 200 rupees from Cash wallet for groceries.
  - Expected operations: ["transfer","expense"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 42401 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"500","model":"gemini-3.1-flash-lite","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 500, model: gemini-3.1-flash-lite, description: Generate content requests per day limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 11h46m41.85637298s.

### gemini-3.5-flash

Blocked without model requests after daily quota: E015, E016, E017, E018, E019, E020, E021, E022, E023, E024, E025, E026, E027, E028, E029, E030, E031, E032, E033, E034, E035, E036, E037, E038, E039, E040, E041, E042, E043, E044, E045, E046, E047, E048, E049, E050, E051, E052, E053, E054, E055, E056, E057, E058, E059, E060, E061, E062, E063, E064, E065, E066, E067, E068, E069, E070, E071, E072. These have unknown accuracy, not demonstrated model failures.

- **E008 — failed**: Today I paid 850 rupees from Everyday bank for groceries.
  - Expected operations: ["expense"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 16 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"5","model":"gemini-3.6-flash","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash, description: Generate content requests per minute limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 16.877723936s.

- **E013 — failed**: Record 500 rupees earned for tutoring today in Cash wallet.
  - Expected operations: ["income"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 24 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"5","model":"gemini-3.6-flash","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash, description: Generate content requests per minute limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 24.719131035s.

- **E014 — failed**: I moved 500 rupees from Cash wallet to Everyday bank today.
  - Expected operations: ["transfer"]; validated predicted operations: null.
  - Error: GEMINI_TRANSIENT_FAILURE. The AI service quota is currently limited. Try again after the provider quota resets.
  - Provider: 429 rate_or_quota_limit; retry guidance 42436 seconds; quotas [{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20","model":"gemini-3.6-flash","location":"global"}]. You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash, description: Generate content requests per day limit exceeded on Free Tier. See https://aistudio.google.com/docs/rate-limits. Please retry in 11h47m16.756182115s.

## Case-by-case results

| Case | Expected operations | Lite result | Flash result | Lite seconds | Flash seconds | Lite USD equivalent | Flash USD equivalent |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| E001 | expense, expense, expense | passed | passed | 12.17 | 33.15 | $0.00274 | $0.02844 |
| E002 | transfer | passed | passed | 7.54 | 13.23 | $0.00120 | $0.01057 |
| E003 | shared_payment | passed | passed | 15.50 | 14.79 | $0.00145 | $0.01447 |
| E004 | shared_payment, settle_claim | passed | passed | 7.68 | 25.41 | $0.00211 | $0.02365 |
| E005 | undo | passed | passed | 14.81 | 12.02 | $0.00098 | $0.01100 |
| E006 | none | passed | passed | 2.52 | 3.87 | $0.00074 | $0.00354 |
| E007 | none | passed | passed | 1.27 | 4.44 | $0.00051 | $0.00308 |
| E008 | expense | passed | failed GEMINI_TRANSIENT_FAILURE | 3.58 | 0.27 | $0.00154 | $0.00000 |
| E009 | expense | passed | passed | 4.82 | 13.42 | $0.00118 | $0.01117 |
| E010 | expense | passed | passed | 8.83 | 14.33 | $0.00118 | $0.01233 |
| E011 | expense | passed | passed | 7.02 | 11.75 | $0.00117 | $0.00889 |
| E012 | income | passed | passed | 3.32 | 12.31 | $0.00117 | $0.00980 |
| E013 | income | passed | failed GEMINI_TRANSIENT_FAILURE | 3.85 | 0.32 | $0.00116 | $0.00000 |
| E014 | transfer | passed | failed GEMINI_TRANSIENT_FAILURE | 3.04 | 7.96 | $0.00119 | $0.00529 |
| E015 | transfer | failed GEMINI_TRANSIENT_FAILURE | blocked | 1.87 | — | $0.00069 | $0.00000 |
| E016 | shared_payment | passed | blocked | 4.03 | — | $0.00132 | $0.00000 |
| E017 | shared_payment | passed | blocked | 3.86 | — | $0.00139 | $0.00000 |
| E018 | lend | passed | blocked | 4.67 | — | $0.00121 | $0.00000 |
| E019 | lend | passed | blocked | 3.83 | — | $0.00120 | $0.00000 |
| E020 | settle_claim | passed | blocked | 5.35 | — | $0.00128 | $0.00000 |
| E021 | settle_claim | passed | blocked | 4.77 | — | $0.00173 | $0.00000 |
| E022 | create_bill | passed | blocked | 2.92 | — | $0.00127 | $0.00000 |
| E023 | create_bill | passed | blocked | 3.91 | — | $0.00135 | $0.00000 |
| E024 | pay_bill | passed | blocked | 3.64 | — | $0.00100 | $0.00000 |
| E025 | pay_bill | passed | blocked | 2.42 | — | $0.00099 | $0.00000 |
| E026 | correct | failed GEMINI_TRANSIENT_FAILURE | blocked | 0.25 | — | $0.00000 | $0.00000 |
| E027 | undo | passed | blocked | 3.92 | — | $0.00095 | $0.00000 |
| E028 | cash_count | passed | blocked | 3.12 | — | $0.00116 | $0.00000 |
| E029 | cash_count | passed | blocked | 7.37 | — | $0.00118 | $0.00000 |
| E030 | query | passed | blocked | 1.58 | — | $0.00066 | $0.00000 |
| E031 | query | passed | blocked | 1.74 | — | $0.00066 | $0.00000 |
| E032 | query | passed | blocked | 1.29 | — | $0.00066 | $0.00000 |
| E033 | query, expense | passed | blocked | 3.56 | — | $0.00137 | $0.00000 |
| E034 | expense, income | passed | blocked | 3.65 | — | $0.00169 | $0.00000 |
| E035 | transfer, expense | failed GEMINI_TRANSIENT_FAILURE | blocked | 0.33 | — | $0.00000 | $0.00000 |
| E036 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E037 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E038 | query | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E039 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E040 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E041 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E042 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E043 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E044 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E045 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E046 | settle_claim | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E047 | settle_claim | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E048 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E049 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E050 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E051 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E052 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E053 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E054 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E055 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E056 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E057 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E058 | query | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E059 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E060 | none | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E061 | lend, settle_claim | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E062 | shared_payment | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E063 | create_bill | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E064 | transfer | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E065 | cash_count | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E066 | expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E067 | settle_claim, income | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E068 | expense, expense | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E069 | undo | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E070 | query | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E071 | income | blocked | blocked | — | — | $0.00000 | $0.00000 |
| E072 | expense, expense | blocked | blocked | — | — | $0.00000 | $0.00000 |

## Limits

- The requested 3.5 ID is routed by Google to 3.6. This is endpoint behavior today, not an evaluation of historical native 3.5 weights.
- One scheduled 72-case run per model stopped by daily quota. Only 11 cases completed for both; no complete 72-case accuracy comparison is claimed. Original holdout cases were inspected during earlier debugging.
- Scores assess the production pipeline after deterministic grounding and guards, not raw standalone model intelligence.
- Detailed expected critical-field labels exist for only two cases. Operation/clarification scores are not a complete audit of every financial field.
- Required clarification is scored one way. Unexpected-clarification flags are diagnostic and can include optional metadata.
- Quota errors and other failed cases are retained, not silently rerun. Conditional model accuracy and all-case pass rates are reported separately.
- Both runs used production provider defaults for thinking, temperature 0 and 25-second requests. Alternative thinking settings or longer deadlines were not tested.
- No streaming token timing or true tokens-per-second generation throughput was measured; latency is end-to-end per case.
- Paid-tier equivalent cost includes observed thinking, cache usage and repair/retry responses. Responses without usage may have unknown billing; costs are not invoices.
- Free Tier was identified by quota responses; actual account billing and maximum daily capacity were not inspected.
- Simultaneous runs share a machine/network; latency varies with cloud load. Pacing/cooldown time is excluded from per-case latency and included in wall time.

## Reproduction and evidence

Run each command from the project root; --model overrides only that test process, not .env.local.

```powershell
node --env-file=.env.local --import tsx scripts/evaluate-detailed.ts --model gemini-3.5-flash --interval-ms 5000 --output docs/evidence/comparison-gemini-3.5-flash-2026-11-07.json
node --env-file=.env.local --import tsx scripts/evaluate-detailed.ts --model gemini-3.1-flash-lite --interval-ms 5000 --output docs/evidence/comparison-gemini-3.1-flash-lite-2026-11-07.json
```

Both JSON files retain every synthetic input, sanitized raw model output, stage timing, HTTP detail and response usage. The combined summary is docs/evidence/model-comparison-2026-11-07.json.

Sources: [Google model-routing notice](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [current token pricing](https://ai.google.dev/gemini-api/docs/pricing), [quota definitions](https://ai.google.dev/gemini-api/docs/rate-limits), [token-accounting metadata](https://googleapis.github.io/js-genai/release_docs/interfaces/types.UsageMetadata.html).
