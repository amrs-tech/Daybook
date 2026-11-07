import { fieldHasEvidence } from "../../lib/agent/evidence";
import { describe, it, expect } from "vitest";
import { groundPlanner, groundWriter } from "../../lib/agent/grounding";
import {
  validatePlanner,
  validateWriter,
  emptyEvidence,
  commonFields,
} from "../../lib/agent/contracts";
import { equivalentCriticalField } from "../../scripts/critical-fields";
import { runAgents } from "../../lib/agent/graph";
import { replayFixtures } from "../../lib/agent/replay";
import { DomainError } from "../../lib/errors";
const reference = "2026-11-05T16:00:00Z";
const source = "Today I paid 250 from Everyday bank.";
const plan = () => ({
  schemaVersion: "2.1",
  promptVersion: "daybook-planner-v2.1",
  intent: "mutate",
  steps: [
    {
      stepRef: "s1",
      kind: "expense",
      sourceExcerpt: source,
      status: "proposed",
      requiresLookup: [],
      dependsOn: [],
      fieldHints: { amountText: "250", method: null, dateText: "today" },
      unresolvedFields: [],
      clarificationQuestions: [],
    },
  ],
  globalQuestions: [],
  unsupportedFragments: [],
});
const writer = () => ({
  schemaVersion: "2.1",
  promptVersion: "daybook-writer-v2.1",
  drafts: [
    {
      stepRef: "s1",
      kind: "expense",
      fields: {
        ...commonFields(),
        amountText: "250",
        bookedOnText: "Today",
        accountAlias: "Everyday bank",
        paymentMethod: "Online",
      },
      evidence: {
        ...emptyEvidence(),
        amount: "250",
        date: "Today",
        account: "Everyday bank",
        method: "Everyday bank",
      },
      unresolvedFields: [],
      questions: [],
    },
  ],
  rejectedSteps: [],
});
describe("Grounding without fabricated financial facts", () => {
  it("reanchors case-only date hints and removes unsupported optional hints", () => {
    const raw = plan();
    raw.steps[0].fieldHints.method = "Cash wallet" as any;
    const grounded = groundPlanner(raw, source);
    expect(grounded.steps[0].fieldHints.dateText).toBe("Today");
    expect(grounded.steps[0].fieldHints.method).toBeNull();
    expect(() => validatePlanner(grounded, source)).not.toThrow();
  });
  it("never repairs an invented operation excerpt", () => {
    const raw = plan();
    raw.steps[0].sourceExcerpt = "invented transfer";
    expect(() => validatePlanner(groundPlanner(raw, source), source)).toThrow(
      "UNVERIFIED_PLANNER_EVIDENCE",
    );
  });
  it("omits an inferred payment rail while preserving required account and money", () => {
    const p = validatePlanner(groundPlanner(plan(), source), source);
    const w = validateWriter(
      groundWriter(writer(), source, p, reference, "Asia/Kolkata"),
      p,
      source,
    );
    expect(w.drafts[0].fields).toMatchObject({
      amountText: "250",
      accountAlias: "Everyday bank",
      paymentMethod: null,
    });
  });
  it("still rejects a changed amount rather than correcting it to a plausible number", () => {
    const p = validatePlanner(groundPlanner(plan(), source), source);
    const w = writer();
    w.drafts[0].fields.amountText = "999";
    const grounded = groundWriter(w, source, p, reference, "Asia/Kolkata");
    expect(grounded.drafts[0].fields).toMatchObject({ amountText: null });
    expect(grounded.drafts[0].unresolvedFields).toContain("amountText");
  });
  it("equates zero and numeric zero only through the exact money parser", () => {
    expect(
      equivalentCriticalField(
        "amountText",
        "2000",
        "2000 rupees",
        reference,
        "Asia/Kolkata",
      ),
    ).toBe(true);
    expect(
      equivalentCriticalField(
        "amountText",
        "2001",
        "2000 rupees",
        reference,
        "Asia/Kolkata",
      ),
    ).toBe(false);
    expect(
      equivalentCriticalField(
        "amountText",
        "1.001",
        "1.00",
        reference,
        "Asia/Kolkata",
      ),
    ).toBe(false);
  });
  it("marks invalid money precision and future completed dates unresolved", () => {
    const p = validatePlanner(groundPlanner(plan(), source), source);
    const w = writer();
    w.drafts[0].fields.amountText = "1.001";
    w.drafts[0].fields.bookedOnText = "2026-11-06";
    const g = groundWriter(w, source, p, reference, "Asia/Kolkata");
    expect(g.drafts[0].unresolvedFields).toEqual(
      expect.arrayContaining(["amountText", "bookedOnText"]),
    );
  });
});
const ctx: any = {
  id: "w",
  ownerId: "u",
  revision: 0,
  timezone: "Asia/Kolkata",
  openedOn: "2026-10-01",
  accounts: [],
  contacts: [],
  claims: [],
  bills: [],
  entries: [],
  balances: {},
  defaults: {},
  closedDays: [],
};
it("does not call the Writer model for a pure query", async () => {
  let calls = 0;
  const p = plan();
  p.intent = "query";
  p.steps[0].kind = "query";
  const result = await runAgents(
    {
      confirmedText: source,
      sourceVersion: 1,
      referenceInstant: reference,
      context: ctx,
      traceId: "test",
    },
    {
      modelId: "test",
      async invoke() {
        calls++;
        return p;
      },
    },
  );
  expect(calls).toBe(1);
  expect(result.writer.drafts).toEqual([]);
  expect(result.writerModelId).toBeUndefined();
});
it("a transient retry shares the same three-call cap and does not retry semantic failure", async () => {
  const fixture = replayFixtures[1];
  let calls = 0;
  const result = await runAgents(
    {
      confirmedText: fixture.text,
      sourceVersion: 1,
      referenceInstant: reference,
      context: ctx,
      traceId: "test",
    },
    {
      modelId: "test",
      async invoke(req) {
        calls++;
        if (calls === 1) throw new DomainError("GEMINI_TRANSIENT_FAILURE", 502);
        return req.role === "planner" ? fixture.planner : fixture.writer;
      },
    },
  );
  expect(result.modelCalls).toBe(3);
  expect(result.transientRetries).toBe(1);
});

it("never accepts a numeric substring as a different amount", () => {
  expect(fieldHasEvidence("amountText", "50", "250 rupees")).toBe(false);
  expect(fieldHasEvidence("amountText", "250", "paid 250 rupees")).toBe(true);
  expect(fieldHasEvidence("personalShareText", "0", "zero")).toBe(true);
});
it("sends only mutation references to the Writer for mixed requests", async () => {
  const fixture = structuredClone(replayFixtures[0]);
  const query = {
    ...fixture.planner.steps[0],
    stepRef: "s1",
    kind: "query" as const,
  };
  const expense = { ...fixture.planner.steps[0], stepRef: "s2" };
  fixture.planner.intent = "mixed";
  fixture.planner.steps = [query, expense];
  fixture.writer.drafts = [{ ...fixture.writer.drafts[0], stepRef: "s2" }];
  fixture.writer.rejectedSteps = [];
  let writerCalled = false;
  const result = await runAgents(
    {
      confirmedText: fixture.text,
      sourceVersion: 1,
      referenceInstant: reference,
      context: ctx,
      traceId: "test",
    },
    {
      modelId: "test",
      async invoke(req) {
        if (req.role === "planner") return fixture.planner;
        writerCalled = true;
        expect(
          (req.payload as any).verifiedPlannerSteps.steps.map(
            (s: any) => s.stepRef,
          ),
        ).toEqual(["s2"]);
        expect(
          JSON.stringify((req.payload as any).allowedFormFieldsByKind),
        ).not.toContain("$schema");
        return fixture.writer;
      },
    },
  );
  expect(writerCalled).toBe(true);
  expect(result.writer.drafts).toHaveLength(1);
});

it("abstains when a bare payment does not identify its economic purpose", () => {
  const input = "Record a payment of 42 rupees yesterday.";
  const p = plan();
  p.steps[0].sourceExcerpt = input;
  const g = groundPlanner(p, input);
  expect(g.intent).toBe("clarify");
  expect(g.steps).toEqual([]);
  expect(g.globalQuestions.length).toBeGreaterThan(0);
});

it("anchors a share to a clause containing both person and amount, never another person", () => {
  const text =
    "Today I paid 600 from Cash wallet; my share was zero, Arun owes 600.";
  const p: any = plan();
  p.steps[0].kind = "shared_payment";
  p.steps[0].sourceExcerpt = text;
  const w: any = writer();
  w.drafts[0].kind = "shared_payment";
  Object.assign(w.drafts[0].fields, {
    accountAlias: "Cash wallet",
    personalShareText: "zero",
    shares: [{ contactAlias: "Arun", amountText: "600" }],
    amountText: "600",
  });
  Object.assign(w.drafts[0].evidence, {
    amount: "600",
    account: "Cash wallet",
    personal: "zero",
    shares: "600",
  });
  const g = groundWriter(w, text, p, reference, "Asia/Kolkata");
  expect(g.drafts[0].evidence.shares).toBe("Arun owes 600.");
  const wrong = groundWriter(
    w,
    "Today I paid 600 from Cash wallet; my share was zero, Priya owes 600.",
    p,
    reference,
    "Asia/Kolkata",
  );
  expect(wrong.drafts[0].unresolvedFields).toContain("shares");
});

it.each([
  ["Arun owes 200 and Priya owes 300.", "300", "200"],
  ["Arun owes 200 Priya owes 300.", "300", "200"],
])(
  "does not accept a broad quote as proof of swapped allocations: %s",
  (allocation, arun, priya) => {
    const text =
      "Today I paid 500 from Cash wallet; my share is zero; " + allocation;
    const p: any = plan();
    p.steps[0].kind = "shared_payment";
    p.steps[0].sourceExcerpt = text;
    const w: any = writer();
    w.drafts[0].kind = "shared_payment";
    Object.assign(w.drafts[0].fields, {
      amountText: "500",
      accountAlias: "Cash wallet",
      personalShareText: "zero",
      shares: [
        { contactAlias: "Arun", amountText: arun },
        { contactAlias: "Priya", amountText: priya },
      ],
    });
    Object.assign(w.drafts[0].evidence, {
      amount: "500",
      account: "Cash wallet",
      personal: "zero",
      shares: text,
    });
    const g = groundWriter(w, text, p, reference, "Asia/Kolkata");
    expect(g.drafts[0].unresolvedFields).toContain("shares");
    expect((g.drafts[0].fields as any).shares).toEqual([]);
  },
);

it("checks exact person amounts with comma grouping and spoken money", () => {
  const text =
    "Today I paid 1,200 from Cash wallet; my share is zero; Arun owes 1,000 and Priya owes two hundred.";
  const p: any = plan();
  p.steps[0].kind = "shared_payment";
  p.steps[0].sourceExcerpt = text;
  const w: any = writer();
  w.drafts[0].kind = "shared_payment";
  Object.assign(w.drafts[0].fields, {
    amountText: "1,200",
    accountAlias: "Cash wallet",
    personalShareText: "zero",
    shares: [
      { contactAlias: "Arun", amountText: "1000" },
      { contactAlias: "Priya", amountText: "200" },
    ],
  });
  Object.assign(w.drafts[0].evidence, {
    amount: "1,200",
    account: "Cash wallet",
    personal: "zero",
    shares: text,
  });
  const g = groundWriter(w, text, p, reference, "Asia/Kolkata");
  expect(g.drafts[0].unresolvedFields).not.toContain("shares");
  expect((g.drafts[0].fields as any).shares).toHaveLength(2);
  expect(() => validateWriter(g, p, text)).not.toThrow();
});
