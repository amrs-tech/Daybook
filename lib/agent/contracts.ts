import { z } from "zod";
import { requireThat } from "../errors";
import { fieldHasEvidence, shareEvidenceQuote } from "./evidence";
export const kinds = [
  "expense",
  "income",
  "transfer",
  "shared_payment",
  "lend",
  "settle_claim",
  "create_bill",
  "pay_bill",
  "correct",
  "undo",
  "cash_count",
  "query",
] as const;
export const lookupKinds = [
  "candidate_transactions",
  "accounts",
  "contacts",
  "claims",
  "bills",
  "balances",
] as const;
const text = z.string().max(500).nullable();
const hints = z
  .object({ amountText: text, method: text, dateText: text })
  .strict();
const step = z
  .object({
    stepRef: z.string().regex(/^s[1-9]\d?$/),
    kind: z.enum(kinds),
    sourceExcerpt: z.string().min(1).max(8000),
    status: z.enum([
      "proposed",
      "needs_lookup",
      "needs_clarification",
      "unsupported",
    ]),
    requiresLookup: z.array(z.enum(lookupKinds)).max(6),
    dependsOn: z.array(z.string()).max(19),
    fieldHints: hints,
    unresolvedFields: z.array(z.string().max(80)).max(20),
    clarificationQuestions: z.array(z.string().max(300)).max(20),
  })
  .strict();
export const PlannerSchema = z
  .object({
    schemaVersion: z.literal("2.1"),
    promptVersion: z.literal("daybook-planner-v2.1"),
    intent: z.enum([
      "mutate",
      "query",
      "mixed",
      "clarify",
      "unsupported",
      "none",
    ]),
    steps: z.array(step).max(20),
    globalQuestions: z.array(z.string().max(300)).max(20),
    unsupportedFragments: z.array(z.string().max(1000)).max(20),
  })
  .strict();
export type PlannerOutput = z.infer<typeof PlannerSchema>;
const fields = {
  amountText: text,
  bookedOnText: text,
  paymentMethod: z.enum(["UPI", "Cash", "Online", "Other"]).nullable(),
  accountAlias: text,
  categoryHint: text,
  description: text,
};
const envelope = {
  stepRef: z.string().regex(/^s[1-9]\d?$/),
  evidence: z
    .object({
      amount: text,
      date: text,
      account: text,
      method: text,
      counterparty: text,
      target: text,
      shares: text,
      personal: text,
      destination: text,
      due: text,
    })
    .strict(),
  unresolvedFields: z.array(z.string().max(80)).max(20),
  questions: z.array(z.string().max(300)).max(20),
};
const object = <T extends Record<string, z.ZodType>>(extra: T) =>
  z.object({ ...fields, ...extra }).strict();
export const DraftSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...envelope, kind: z.literal("expense"), fields: object({}) })
    .strict(),
  z
    .object({ ...envelope, kind: z.literal("income"), fields: object({}) })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("transfer"),
      fields: object({ destinationAlias: text }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("shared_payment"),
      fields: object({
        personalShareText: text,
        shares: z
          .array(
            z
              .object({
                contactAlias: z.string().min(1).max(80),
                amountText: z.string().min(1).max(100),
              })
              .strict(),
          )
          .max(10),
      }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("lend"),
      fields: object({ counterpartyAlias: text }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("settle_claim"),
      fields: object({ counterpartyAlias: text, targetHint: text }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("create_bill"),
      fields: object({ dueOnText: text, counterpartyAlias: text }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("pay_bill"),
      fields: object({ targetHint: text }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("undo"),
      fields: z
        .object({ targetHint: text, bookedOnText: text, description: text })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("correct"),
      fields: object({ targetHint: text }),
    })
    .strict(),
  z
    .object({ ...envelope, kind: z.literal("cash_count"), fields: object({}) })
    .strict(),
]);
export const WriterSchema = z
  .object({
    schemaVersion: z.literal("2.1"),
    promptVersion: z.literal("daybook-writer-v2.1"),
    drafts: z.array(DraftSchema).max(20),
    rejectedSteps: z
      .array(
        z.object({ stepRef: z.string(), reason: z.string().max(500) }).strict(),
      )
      .max(20),
  })
  .strict();
export type WriterOutput = z.infer<typeof WriterSchema>;
export type WriterDraft = z.infer<typeof DraftSchema>;
export const emptyEvidence = () => ({
  amount: null,
  date: null,
  account: null,
  method: null,
  counterparty: null,
  target: null,
  shares: null,
  personal: null,
  destination: null,
  due: null,
});
export const commonFields = () => ({
  amountText: null,
  bookedOnText: null,
  paymentMethod: null,
  accountAlias: null,
  categoryHint: null,
  description: null,
});
export function validatePlanner(raw: unknown, source: string): PlannerOutput {
  const plan = PlannerSchema.parse(raw);
  const seen = new Set<string>();
  for (const [i, s] of plan.steps.entries()) {
    requireThat(
      s.stepRef === `s${i + 1}` && !seen.has(s.stepRef),
      "INVALID_STEP_REFERENCE",
    );
    requireThat(
      source.includes(s.sourceExcerpt),
      "UNVERIFIED_PLANNER_EVIDENCE",
    );
    requireThat(
      s.dependsOn.every((d) => seen.has(d)),
      "INVALID_DEPENDENCY",
    );
    seen.add(s.stepRef);
    for (const v of Object.values(s.fieldHints))
      if (v) requireThat(source.includes(v), "UNVERIFIED_HINT");
  }
  requireThat(
    !(plan.intent === "none" && plan.steps.length),
    "PLAN_INTENT_CONTRADICTION",
  );
  // Conservative hard-case guard. It blocks the complete batch rather than guessing which
  // fragment a model may have dropped; a clarified source can be interpreted again.
  if (
    plan.steps.some(
      (s) => !["query", "create_bill", "cash_count"].includes(s.kind),
    ) &&
    /\b(?:don['’]t record|do not record|i might|if i (?:spent|paid)|not sure|fifteen or fifty|maybe|i think)\b/i.test(
      source,
    )
  ) {
    requireThat(
      plan.intent === "clarify" ||
        plan.steps.every(
          (s) => s.kind === "query" || s.status === "needs_clarification",
        ),
      "SOURCE_REQUIRES_CLARIFICATION",
    );
  }
  return plan;
}
export function validateWriter(
  raw: unknown,
  plan: PlannerOutput,
  source: string,
): WriterOutput {
  const writer = WriterSchema.parse(raw);
  const seen = new Set<string>();
  for (const d of writer.drafts) {
    const s = plan.steps.find((x) => x.stepRef === d.stepRef);
    requireThat(
      s && s.kind === d.kind && s.status !== "unsupported",
      "UNAUTHORIZED_WRITER_OPERATION",
    );
    requireThat(!seen.has(d.stepRef), "DUPLICATE_WRITER_STEP");
    seen.add(d.stepRef);
    for (const value of Object.values(d.evidence))
      if (value)
        requireThat(source.includes(value), "UNVERIFIED_WRITER_EVIDENCE");
    const fieldMap: Record<string, string> = {
      amountText: "amount",
      bookedOnText: "date",
      paymentMethod: "method",
      accountAlias: "account",
      counterpartyAlias: "counterparty",
      destinationAlias: "destination",
      targetHint: "target",
      personalShareText: "personal",
      dueOnText: "due",
    };
    for (const [field, evidence] of Object.entries(fieldMap)) {
      const value = (d.fields as Record<string, unknown>)[field];
      if (typeof value === "string")
        requireThat(
          fieldHasEvidence(
            field,
            value,
            (d.evidence as Record<string, string | null>)[evidence],
          ),
          `MISSING_FIELD_EVIDENCE:${field}`,
        );
    }
    if (d.kind === "shared_payment" && d.fields.shares.length > 0)
      requireThat(
        shareEvidenceQuote(d.evidence.shares ?? "", d.fields.shares) !== null,
        "MISSING_SPLIT_EVIDENCE",
      );
  }
  for (const r of writer.rejectedSteps) {
    requireThat(
      plan.steps.some((s) => s.stepRef === r.stepRef && s.kind !== "query") &&
        !seen.has(r.stepRef),
      "INVALID_REJECTED_STEP",
    );
    seen.add(r.stepRef);
  }
  requireThat(
    plan.steps
      .filter((s) => s.kind !== "query")
      .every((s) => seen.has(s.stepRef)),
    "WRITER_DROPPED_OPERATION",
  );
  return writer;
}
