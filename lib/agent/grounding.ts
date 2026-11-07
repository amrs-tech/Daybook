import { parseINR } from "../money";
import { parseBookedOn } from "../dates";
import { fieldHasEvidence, shareEvidenceQuote } from "./evidence";
import { PlannerSchema, WriterSchema, type PlannerOutput } from "./contracts";

/** Only formatting is re-anchored. Unknown critical facts are never supplied. */
export function sourceQuote(
  source: string,
  value: string | null,
): string | null {
  if (value === null) return null;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i").exec(source)?.[0] ?? null;
}
export function groundPlanner(raw: unknown, source: string) {
  const plan = PlannerSchema.parse(raw);
  for (const step of plan.steps) {
    step.sourceExcerpt =
      sourceQuote(source, step.sourceExcerpt) ?? step.sourceExcerpt;
    for (const key of ["amountText", "method", "dateText"] as const) {
      const value = step.fieldHints[key];
      if (value !== null) step.fieldHints[key] = sourceQuote(source, value);
    }
  }
  if (
    /\b(?:add|record|log|enter)\b/i.test(source) &&
    plan.intent !== "unsupported" &&
    plan.steps.some((step) => step.kind === "expense") &&
    !plan.steps.some((step) => step.kind === "query") &&
    /\bpayment\b/i.test(source) &&
    !/\b(?:for|to|transfer|loan|bill|rent|salary|repay|repayment|income|expense|received|earned|lent|donation)\b/i.test(
      source,
    )
  ) {
    plan.intent = "clarify";
    plan.steps = [];
    plan.globalQuestions = [
      "Was this payment an expense, a transfer, or a repayment? Please describe its purpose.",
    ];
  }
  const externalCommand =
    /^\s*(?:please\s+)?(?:pay|send|buy|purchase|execute)\b/i.test(source) &&
    /\b(?:automatically|real bank|for me|stock|shares|securities)\b/i.test(
      source,
    );
  const refundAsIncome =
    /\brefund\b/i.test(source) &&
    /\b(?:as|into)\s+(?:salary|income)\b/i.test(source);
  if (externalCommand || refundAsIncome) {
    plan.intent = refundAsIncome ? "clarify" : "unsupported";
    plan.steps = [];
    plan.globalQuestions = refundAsIncome
      ? [
          "A refund is not salary. Identify the original expense and use a supported correction workflow.",
        ]
      : [];
    plan.unsupportedFragments = [source];
  }
  if (
    /^\s*(?:set|overwrite|change)\b/i.test(source) &&
    /\b(?:bank|account)\s+balance\b/i.test(source) &&
    /\bwithout\b/i.test(source)
  ) {
    plan.intent = "clarify";
    plan.steps = [];
    plan.globalQuestions = [
      "A bank balance needs an opening record or a supported correction. Which source record establishes this balance?",
    ];
  }
  for (const step of plan.steps)
    if (step.kind === "query" && step.status === "needs_clarification")
      for (const question of step.clarificationQuestions)
        if (!plan.globalQuestions.includes(question))
          plan.globalQuestions.push(question);
  if (
    plan.steps.some((step) => step.kind === "query") &&
    /\bcash\s+count\b/i.test(source) &&
    /\b(?:difference|less|more|compare)\b/i.test(source) &&
    !/[0-9]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand)\b/i.test(
      source,
    )
  ) {
    plan.globalQuestions.push(
      "What cash amount did you count? The ledger alone cannot establish your physical cash count.",
    );
  }
  return plan;
}
export function explicitlySupportedMethod(
  source: string,
  method: string,
): boolean {
  // An asset account is not evidence of a payment rail.
  const withoutAccount = source.replace(/\bcash\s+wallet\b/gi, "");
  return new RegExp(`\\b${method}\\b`, "i").test(withoutAccount);
}
export function groundWriter(
  raw: unknown,
  source: string,
  plan: PlannerOutput,
  reference: string,
  timezone: string,
) {
  const writer = WriterSchema.parse(raw);
  for (const draft of writer.drafts) {
    for (const key of Object.keys(
      draft.evidence,
    ) as (keyof typeof draft.evidence)[]) {
      const value = draft.evidence[key];
      if (value !== null)
        draft.evidence[key] = sourceQuote(source, value) ?? value;
    }
    const fields = draft.fields as Record<string, any>;
    // Payment method is optional and cannot be inferred from an account. Omit an
    // unsupported optional suggestion rather than retaining a fabricated fact.
    if (
      fields.paymentMethod &&
      (!explicitlySupportedMethod(source, fields.paymentMethod) ||
        !fieldHasEvidence(
          "paymentMethod",
          fields.paymentMethod,
          draft.evidence.method,
        ) ||
        !source.includes(draft.evidence.method ?? "\u0000"))
    ) {
      fields.paymentMethod = null;
      draft.evidence.method = null;
    }
    const labels: Record<string, string> = {
      amountText: "amount",
      bookedOnText: "transaction date",
      accountAlias: "payment account",
      counterpartyAlias: "person or business",
      destinationAlias: "destination account",
      targetHint: "existing record",
      personalShareText: "personal share",
      dueOnText: "due date",
    };
    const clarify = (field: string, question: string) => {
      if (!draft.unresolvedFields.includes(field))
        draft.unresolvedFields.push(field);
      if (!draft.questions.includes(question)) draft.questions.push(question);
    };
    if (typeof fields.amountText === "string")
      try {
        parseINR(fields.amountText, draft.kind === "cash_count");
      } catch {
        clarify(
          "amountText",
          "Confirm an unambiguous amount with at most two decimal places.",
        );
      }
    if (typeof fields.bookedOnText === "string")
      try {
        parseBookedOn(fields.bookedOnText, reference, timezone);
      } catch {
        clarify("bookedOnText", "Confirm the date of the completed event.");
      }
    if (
      draft.kind === "transfer" &&
      fields.accountAlias &&
      fields.destinationAlias &&
      fields.accountAlias.toLowerCase() ===
        fields.destinationAlias.toLowerCase()
    )
      clarify("destinationAlias", "Choose a different destination account.");
    const fieldMap: Record<string, string> = {
      amountText: "amount",
      bookedOnText: "date",
      accountAlias: "account",
      counterpartyAlias: "counterparty",
      destinationAlias: "destination",
      targetHint: "target",
      personalShareText: "personal",
      dueOnText: "due",
    };
    for (const [field, key] of Object.entries(fieldMap)) {
      const value = fields[field];
      const evidence = (draft.evidence as any)[key];
      if (
        typeof value === "string" &&
        (!evidence ||
          !source.includes(evidence) ||
          !fieldHasEvidence(field, value, evidence))
      ) {
        fields[field] = null;
        (draft.evidence as any)[key] = null;
        clarify(
          field,
          "Confirm the " +
            (labels[field] ?? "missing detail") +
            " from the original instruction or review form.",
        );
      }
    }
    // Unsupported evidence is never kept as an asserted source quote.
    for (const key of Object.keys(
      draft.evidence,
    ) as (keyof typeof draft.evidence)[]) {
      const value = draft.evidence[key];
      if (value && !source.includes(value)) draft.evidence[key] = null;
    }
    if (draft.kind === "shared_payment") {
      const shares = (draft.fields as any).shares as {
        contactAlias: string;
        amountText: string;
      }[];
      draft.evidence.shares = shareEvidenceQuote(source, shares);
      if (shares.length > 0 && !draft.evidence.shares) {
        (draft.fields as any).shares = [];
        clarify("shares", "Confirm each person's share before posting.");
      }
    }
    const required = [
      "bookedOnText",
      ...(draft.kind === "undo" ? [] : ["amountText"]),
      ...(["create_bill", "undo"].includes(draft.kind) ? [] : ["accountAlias"]),
      ...(draft.kind === "create_bill" ? ["dueOnText"] : []),
      ...(draft.kind === "transfer" ? ["destinationAlias"] : []),
      ...(["lend", "settle_claim"].includes(draft.kind)
        ? ["counterpartyAlias"]
        : []),
      ...(["settle_claim", "pay_bill", "undo", "correct"].includes(draft.kind)
        ? ["targetHint"]
        : []),
    ];
    for (const field of required)
      if (!fields[field])
        clarify(
          field,
          "Confirm the " +
            (labels[field] ?? "missing detail") +
            " before posting.",
        );
    const step = plan.steps.find((s) => s.stepRef === draft.stepRef);
    if (step?.status === "needs_clarification")
      for (const field of step.unresolvedFields)
        if (!draft.unresolvedFields.includes(field))
          draft.unresolvedFields.push(field);
  }
  return writer;
}
