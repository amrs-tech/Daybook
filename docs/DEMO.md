# Demonstration and synthetic records

## Seed narrative

The seed is explicit synthetic data: bank opening ₹25,000 and cash opening ₹5,000 against equity; two ₹850 grocery entries as duplicate candidates; ₹1,200 fuel from cash; ₹2,400 team dinner with ₹800 personal expense and ₹800 claims for Arun and Priya; Priya repays ₹500. Seed entries have no claim of real user approval or bank verification and are clearly identified by synthetic step references.

Canonical seeded totals: bank ₹21,400; cash ₹3,800; personal expense ₹3,700; receivable ₹1,100 (Arun ₹800, Priya ₹300); earned income ₹0. Equal grocery records are candidates, not automatically established duplicates.

## Scenario A

Choose **Three everyday expenses** and confirm interpretation. Three separate cards show ₹250, ₹450 and ₹120. The missing date and actual account require review. Choose today, bank for coffee/lunch and cash for parking. Save the changes and preview. Approve the complete batch. The API integration test verifies three persisted entries and an identical receipt on repeat approval. Live voice recognition of the script remains blocked.

## Scenario B

Use: “Yesterday I paid 2400 rupees for team dinner. Arun owes me 800 and Priya owes me 800. Priya already returned 500.” The exact source is available as a replay fixture. The personal share, payment account, receipt date/account and specific settlement target remain explicit human decisions. A new claim from the first step can be selected with a “New in this batch” target. Existing similar dinner/repayment records require a separate-event duplicate acknowledgement before posting. New canonical outstanding amounts are Arun ₹800 and Priya ₹300; repayment is not income.

The seeded workspace already has a similar dinner and repayment. Do not describe posting this again as fixing the seed. The separate SQL/API scenario uses a deliberately reviewed new synthetic event, and checks new receipt-linked claim records only.

## Scenario C

Use the exact **Find a duplicate** example from the fixture list/source file. Planner requests owner-scoped candidate transactions. Writer leaves the immutable reversal target unresolved. Select the precise record and review the reversal; similar amount/date alone never triggers a write. Existing originals remain visible.

## Scenario D and E

An ambiguous ₹500 payment is rejected for clarification about economic direction/purpose/account. A pure request to skip approval and insert directly produces no actions. Both are exercised through authenticated API handlers and verified to have no financial effect.

## Two-minute live walkthrough after access is configured

1. Show synthetic records and microphone/text tabs.
2. Record and explicitly transcribe a short script; edit numbers if needed, then confirm interpretation.
3. Show distinct Planner steps and Writer cards, literal evidence, missing fields and journal preview.
4. Approve, inspect the persisted receipt and canonical entries, and refresh.
5. Demonstrate a settlement target or duplicate ambiguity; no silent choice.
6. Open a real redacted Langfuse trace, and report actual model IDs, measured results and remaining limitations.

No walkthrough video, successful live microphone journey, exported trace or public deployment is claimed in this build.
