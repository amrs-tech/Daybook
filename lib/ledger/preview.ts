import { createHash, randomUUID } from "node:crypto";
import { parseINR } from "../money";
import { parseBookedOn } from "../dates";
import { DomainError, requireThat } from "../errors";
import type { WriterOutput, PlannerOutput } from "../agent/contracts";
import {
  ActionSchema,
  type Action,
  type Context,
  type Effect,
  type Issue,
  type Preview,
} from "./types";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function match<T extends { id: string; label: string }>(
  items: T[],
  alias: string | null,
): T {
  requireThat(alias, "MISSING_REFERENCE");
  const matches = items.filter(
    (a) => a.label.toLowerCase() === alias.trim().toLowerCase(),
  );
  requireThat(
    matches.length === 1,
    matches.length ? "AMBIGUOUS_REFERENCE" : "UNKNOWN_REFERENCE",
  );
  return matches[0];
}
export function normalizeDrafts(
  writer: WriterOutput,
  context: Context,
  reference: string,
  plan: PlannerOutput,
  oldActions: Action[] = [],
): { actions: Action[]; issues: Issue[] } {
  const actions: Action[] = [],
    issues: Issue[] = [],
    pendingClaims: {
      id: string;
      contactId: string;
      label: string;
      ref: string;
    }[] = [];
  for (const rejected of writer.rejectedSteps)
    issues.push({
      stepRef: rejected.stepRef,
      field: "operation",
      code: "REJECTED_STEP",
      message: rejected.reason,
    });
  for (const d of writer.drafts) {
    const p = plan.steps.find((s) => s.stepRef === d.stepRef);
    if (!p || p.kind !== d.kind || p.status === "unsupported") {
      issues.push({
        stepRef: d.stepRef,
        field: "operation",
        code: "UNAUTHORIZED_OPERATION",
        message: "This operation was not authorized by the plan.",
      });
      continue;
    }
    if (p.status === "needs_clarification")
      issues.push({
        stepRef: d.stepRef,
        field: "source",
        code: "PLANNER_CLARIFICATION",
        message:
          p.clarificationQuestions.join(" ") ||
          "Clarify the original instruction and interpret it again.",
      });
    if (d.unresolvedFields.length) {
      issues.push(
        ...d.unresolvedFields
          .filter(
            (field) =>
              ![
                "paymentMethod",
                "categoryHint",
                "description",
                ...(d.kind === "create_bill"
                  ? ["accountAlias", "counterpartyAlias"]
                  : []),
              ].includes(field),
          )
          .map((field) => ({
            stepRef: d.stepRef,
            field,
            code: "NEEDS_CLARIFICATION",
            message: d.questions.join(" ") || `Confirm ${field}.`,
          })),
      );
    }
    let currentField = "bookedOnText";
    try {
      const f = d.fields as Record<string, unknown>;
      const need = (key: string) => {
        currentField = key;
        const v = f[key];
        requireThat(typeof v === "string" && v.trim(), `MISSING_${key}`);
        return v as string;
      };
      const bookedOn = parseBookedOn(
        need("bookedOnText"),
        reference,
        context.timezone,
        context.openedOn,
      );
      const description =
        typeof f.description === "string" ? f.description : d.kind;
      const base = { stepRef: d.stepRef, bookedOn, description };
      const target = (type: "entry" | "claim" | "bill") => {
        const hint = need("targetHint");
        // Stable IDs must have been selected in human review or occur as exact lookup references.
        if (type === "claim") {
          const pending = pendingClaims.find((c) => c.ref === hint);
          if (pending) {
            requireThat(
              p.dependsOn.includes(hint.split(":")[1]),
              "MISSING_SETTLEMENT_DEPENDENCY",
            );
            return pending.id;
          }
        }
        const list =
          type === "entry"
            ? context.entries
            : type === "claim"
              ? context.claims
              : context.bills;
        const result = list.find((x) => x.id === hint);
        requireThat(result, "TARGET_SELECTION_REQUIRED");
        return result.id;
      };
      if (d.kind === "undo") {
        actions.push(
          ActionSchema.parse({
            ...base,
            kind: "undo",
            targetId: target("entry"),
          }),
        );
        continue;
      }
      currentField = "amountText";
      const amount = parseINR(
        need("amountText"),
        d.kind === "cash_count",
      ).toString();
      const old = oldActions.find((a) => a.stepRef === d.stepRef);
      if (d.kind === "create_bill") {
        const dueOn = parseBookedOn(
          need("dueOnText"),
          reference,
          context.timezone,
          context.openedOn,
          true,
        );
        actions.push(
          ActionSchema.parse({
            ...base,
            kind: d.kind,
            amount,
            dueOn,
            billId: old?.kind === "create_bill" ? old.billId : randomUUID(),
          }),
        );
        continue;
      }
      currentField = "accountAlias";
      let alias = f.accountAlias as string | null;
      const method = f.paymentMethod as string | null;
      if (!alias && method && context.defaults[method]) {
        alias =
          context.accounts.find((a) => a.id === context.defaults[method])
            ?.label ?? null;
      }
      const account = match(
        context.accounts.filter((a) => a.kind === "bank" || a.kind === "cash"),
        alias,
      );
      const financial = { ...base, amount, accountId: account.id };
      let action: unknown;
      switch (d.kind) {
        case "expense":
        case "income":
          action = { ...financial, kind: d.kind };
          break;
        case "transfer":
          currentField = "destinationAlias";
          action = {
            ...financial,
            kind: d.kind,
            destinationId: match(
              context.accounts.filter(
                (a) => a.kind === "bank" || a.kind === "cash",
              ),
              need("destinationAlias"),
            ).id,
          };
          break;
        case "shared_payment": {
          currentField = "personalShareText";
          const personal = parseINR(need("personalShareText"), true).toString();
          currentField = "shares";
          const shares = (
            f.shares as { contactAlias: string; amountText: string }[]
          ).map((s) => {
            const contact = match(context.contacts, s.contactAlias);
            return {
              contactId: contact.id,
              amount: parseINR(s.amountText).toString(),
              claimId:
                old?.kind === "shared_payment"
                  ? (old.shares.find((x) => x.contactId === contact.id)
                      ?.claimId ?? randomUUID())
                  : randomUUID(),
            };
          });
          action = { ...financial, kind: d.kind, personal, shares };
          break;
        }
        case "lend": {
          currentField = "counterpartyAlias";
          action = {
            ...financial,
            kind: d.kind,
            contactId: match(context.contacts, need("counterpartyAlias")).id,
            claimId: old?.kind === "lend" ? old.claimId : randomUUID(),
          };
          break;
        }
        case "settle_claim": {
          const claimId = target("claim"),
            claim = [...context.claims, ...pendingClaims].find(
              (c) => c.id === claimId,
            );
          if (f.counterpartyAlias)
            requireThat(
              claim?.contactId ===
                match(context.contacts, f.counterpartyAlias as string).id,
              "SETTLEMENT_CONTACT_MISMATCH",
            );
          action = { ...financial, kind: d.kind, claimId };
          break;
        }
        case "pay_bill":
          action = { ...financial, kind: d.kind, billId: target("bill") };
          break;
        case "correct": {
          const targetId = target("entry"),
            original = context.entries.find((e) => e.id === targetId)!;
          requireThat(
            original.kind === "expense" || original.kind === "income",
            "CORRECTION_KIND_UNSUPPORTED",
          );
          action = {
            ...financial,
            kind: d.kind,
            targetId,
            replacementKind: original.kind,
          };
          break;
        }
        case "cash_count":
          requireThat(account.kind === "cash", "COUNT_REQUIRES_CASH_ACCOUNT");
          action = { ...financial, kind: d.kind };
          break;
      }
      const normalized = ActionSchema.parse(action);
      actions.push(normalized);
      if (normalized.kind === "shared_payment")
        for (const share of normalized.shares) {
          const contact = context.contacts.find(
            (c) => c.id === share.contactId,
          )!;
          pendingClaims.push({
            id: share.claimId,
            contactId: contact.id,
            label: contact.label,
            ref: `new:${d.stepRef}:${contact.label}`,
          });
        }
      if (normalized.kind === "lend") {
        const contact = context.contacts.find(
          (c) => c.id === normalized.contactId,
        )!;
        pendingClaims.push({
          id: normalized.claimId,
          contactId: contact.id,
          label: contact.label,
          ref: `new:${d.stepRef}:${contact.label}`,
        });
      }
    } catch (e) {
      issues.push({
        stepRef: d.stepRef,
        field: currentField,
        code: e instanceof DomainError ? e.code : "INVALID_FORM",
        message:
          e instanceof DomainError
            ? e.code.replaceAll("_", " ")
            : "Review the fields for this operation.",
      });
    }
  }
  return { actions, issues };
}

/** Pure financial planner. PostgreSQL independently rebuilds these effects at commit. */
export function planEffects(
  actions: Action[],
  context: Context,
): { effects: Effect[]; warnings: Issue[]; issues: Issue[] } {
  const effects: Effect[] = [],
    warnings: Issue[] = [],
    issues: Issue[] = [];
  const claims = new Map(
    context.claims.map((c) => [c.id, BigInt(c.outstanding)]),
  );
  const claimDates = new Map(context.claims.map((c) => [c.id, c.openedOn]));
  const paid = new Set(context.bills.filter((b) => b.paid).map((b) => b.id));
  const reversed = new Set(
    context.entries.filter((e) => e.reversed).map((e) => e.id),
  );
  const system = (kind: string) => {
    const a = context.accounts.find((a) => a.kind === kind);
    requireThat(a, "MISSING_SYSTEM_ACCOUNT");
    return a.id;
  };
  const owned = (id: string) => {
    const a = context.accounts.find((a) => a.id === id);
    requireThat(a, "ACCOUNT_NOT_OWNED", 404);
    return a;
  };
  for (const action of actions) {
    try {
      const a = ActionSchema.parse(action),
        lines: { accountId: string; amount: string }[] = [];
      const line = (id: string, n: bigint) => {
        owned(id);
        if (n) lines.push({ accountId: id, amount: n.toString() });
      };
      const amount = "amount" in a ? BigInt(a.amount) : 0n;
      if ("accountId" in a) {
        const account = owned(a.accountId);
        requireThat(
          account.kind === "cash" || account.kind === "bank",
          "INVALID_PAYMENT_ACCOUNT",
        );
      }
      switch (a.kind) {
        case "expense":
          line(system("expense"), amount);
          line(a.accountId, -amount);
          break;
        case "income":
          line(a.accountId, amount);
          line(system("income"), -amount);
          break;
        case "transfer":
          requireThat(a.accountId !== a.destinationId, "SAME_TRANSFER_ACCOUNT");
          requireThat(
            ["bank", "cash"].includes(owned(a.destinationId).kind),
            "INVALID_DESTINATION",
          );
          line(a.destinationId, amount);
          line(a.accountId, -amount);
          break;
        case "shared_payment": {
          requireThat(
            BigInt(a.personal) +
              a.shares.reduce((s, x) => s + BigInt(x.amount), 0n) ===
              amount,
            "SPLIT_TOTAL_MISMATCH",
          );
          requireThat(
            new Set(a.shares.map((s) => s.contactId)).size === a.shares.length,
            "DUPLICATE_CONTACT_SHARE",
          );
          line(system("expense"), BigInt(a.personal));
          line(system("receivable"), amount - BigInt(a.personal));
          line(a.accountId, -amount);
          for (const s of a.shares) {
            requireThat(
              context.contacts.some((c) => c.id === s.contactId),
              "UNKNOWN_CONTACT",
            );
            requireThat(!claims.has(s.claimId), "CLAIM_ALREADY_EXISTS");
            claims.set(s.claimId, BigInt(s.amount));
            claimDates.set(s.claimId, a.bookedOn);
          }
          break;
        }
        case "lend":
          requireThat(
            context.contacts.some((c) => c.id === a.contactId),
            "UNKNOWN_CONTACT",
          );
          requireThat(!claims.has(a.claimId), "CLAIM_ALREADY_EXISTS");
          line(system("receivable"), amount);
          line(a.accountId, -amount);
          claims.set(a.claimId, amount);
          claimDates.set(a.claimId, a.bookedOn);
          break;
        case "settle_claim": {
          const outstanding = claims.get(a.claimId);
          requireThat(outstanding !== undefined, "CLAIM_NOT_FOUND", 404);
          requireThat(amount <= outstanding, "OVER_SETTLEMENT");
          requireThat(
            a.bookedOn >= (claimDates.get(a.claimId) ?? a.bookedOn),
            "SETTLEMENT_BEFORE_CLAIM",
          );
          line(a.accountId, amount);
          line(system("receivable"), -amount);
          claims.set(a.claimId, outstanding - amount);
          break;
        }
        case "create_bill":
          break;
        case "pay_bill": {
          const bill = context.bills.find((b) => b.id === a.billId);
          requireThat(bill, "BILL_NOT_FOUND", 404);
          requireThat(!paid.has(a.billId), "BILL_ALREADY_PAID", 409);
          requireThat(a.amount === bill.amount, "BILL_AMOUNT_MISMATCH");
          requireThat(a.bookedOn >= bill.createdOn, "PAYMENT_BEFORE_BILL");
          line(system("expense"), amount);
          line(a.accountId, -amount);
          paid.add(a.billId);
          break;
        }
        case "correct":
        case "undo": {
          const original = context.entries.find((e) => e.id === a.targetId);
          requireThat(original, "TARGET_NOT_FOUND", 404);
          requireThat(!reversed.has(a.targetId), "ALREADY_REVERSED", 409);
          requireThat(
            !["opening", "reversal", "correction"].includes(original.kind),
            "REVERSAL_UNSUPPORTED",
          );
          if (["shared_payment", "lend"].includes(original.kind))
            requireThat(
              context.claims
                .filter((c) => c.entryId === original.id)
                .every(
                  (c) =>
                    !context.entries.some(
                      (e) =>
                        e.kind === "settle_claim" &&
                        !e.reversed &&
                        e.claimId === c.id,
                    ),
                ),
              "DEPENDENT_SETTLEMENT",
            );
          // DB also checks immutable lifecycle links; context summaries cannot authorize a dependent reversal.
          for (const l of original.lines) line(l.accountId, -BigInt(l.amount));
          reversed.add(a.targetId);
          if (a.kind === "correct") {
            requireThat(
              original.kind === a.replacementKind,
              "CORRECTION_KIND_MISMATCH",
            );
            line(
              a.replacementKind === "expense" ? system("expense") : a.accountId,
              amount,
            );
            line(
              a.replacementKind === "expense" ? a.accountId : system("income"),
              -amount,
            );
          }
          break;
        }
        case "cash_count":
          requireThat(
            owned(a.accountId).kind === "cash",
            "COUNT_REQUIRES_CASH_ACCOUNT",
          );
          warnings.push({
            stepRef: a.stepRef,
            field: "amount",
            code: "OBSERVATION_ONLY",
            message:
              "Counted cash is an observation. Any difference remains unresolved.",
          });
          break;
      }
      if (lines.length)
        requireThat(
          lines.length >= 2 &&
            lines.reduce((s, l) => s + BigInt(l.amount), 0n) === 0n,
          "UNBALANCED_JOURNAL",
        );
      if (context.closedDays.some((d) => a.bookedOn <= d))
        issues.push({
          stepRef: a.stepRef,
          field: "bookedOnText",
          code: "CLOSED_DAY_REVIEW_REQUIRED",
          message:
            "This date falls within a closed day. Reopen and review it before posting.",
        });
      if (
        [
          "expense",
          "income",
          "transfer",
          "shared_payment",
          "lend",
          "settle_claim",
          "pay_bill",
        ].includes(a.kind) &&
        "accountId" in a &&
        context.entries.some(
          (e) =>
            !e.reversed &&
            e.kind === a.kind &&
            e.bookedOn === a.bookedOn &&
            e.amount === a.amount &&
            e.accountId === a.accountId &&
            e.description.toLowerCase() === a.description.toLowerCase(),
        )
      )
        warnings.push({
          stepRef: a.stepRef,
          field: "duplicate",
          code: "DUPLICATE_CANDIDATE",
          message:
            "A matching amount, date, account and description exists. Confirm whether this is a separate event.",
        });
      effects.push({
        stepRef: a.stepRef,
        kind: a.kind,
        bookedOn: a.bookedOn,
        description: a.description,
        lines,
      });
    } catch (e) {
      issues.push({
        stepRef: action.stepRef,
        field: "operation",
        code: e instanceof DomainError ? e.code : "INVALID_ACTION",
        message: e instanceof Error ? e.message : "Invalid action",
      });
    }
  }
  return { effects, warnings, issues };
}
export function makePreview(
  actions: Action[],
  context: Context,
  version: number,
  sourceVersion: number,
  acknowledgedDuplicates = false,
): Preview {
  const result = planEffects(actions, context);
  if (!acknowledgedDuplicates)
    for (const w of result.warnings.filter(
      (w) => w.code === "DUPLICATE_CANDIDATE",
    ))
      result.issues.push(w);
  return {
    ...result,
    actions,
    revision: context.revision,
    version,
    planHash: digest({
      actions,
      version,
      sourceVersion,
      revision: context.revision,
      acknowledgedDuplicates,
    }),
  };
}
