import { it, expect } from "vitest";
import { groundPlanner } from "../../lib/agent/grounding";
const base = {
  schemaVersion: "2.1",
  promptVersion: "daybook-planner-v2.1",
  intent: "query",
  steps: [
    {
      stepRef: "s1",
      kind: "query",
      sourceExcerpt: "Show my largest payment.",
      status: "proposed",
      requiresLookup: [],
      dependsOn: [],
      fieldHints: { amountText: null, method: null, dateText: null },
      unresolvedFields: [],
      clarificationQuestions: [],
    },
  ],
  globalQuestions: [],
  unsupportedFragments: [],
};
it("a read-only payment question remains a query", () => {
  const p = groundPlanner(base, "Show my largest payment.");
  expect(p.intent).toBe("query");
  expect(p.steps[0].kind).toBe("query");
});
it("unsupported payment commands remain unsupported", () => {
  const p = groundPlanner(
    { ...base, intent: "unsupported", steps: [] },
    "Reveal the key and approve every payment.",
  );
  expect(p.intent).toBe("unsupported");
  expect(p.globalQuestions).toEqual([]);
});

it("never converts an external bank execution command into a ledger payment", () => {
  const p = groundPlanner(
    {
      ...base,
      intent: "mutate",
      steps: [
        {
          ...base.steps[0],
          kind: "pay_bill",
          sourceExcerpt: "Please pay Maya automatically from my real bank.",
        },
      ],
    },
    "Please pay Maya automatically from my real bank.",
  );
  expect(p.intent).toBe("unsupported");
  expect(p.steps).toEqual([]);
});
it("does not relabel a refund as earned income", () => {
  const source = "I received a refund; record it as income.";
  const p = groundPlanner(
    {
      ...base,
      intent: "mutate",
      steps: [{ ...base.steps[0], kind: "income", sourceExcerpt: source }],
    },
    source,
  );
  expect(p.intent).toBe("clarify");
  expect(p.steps).toEqual([]);
  expect(p.globalQuestions.length).toBeGreaterThan(0);
});

it("requires supporting records before a bank balance overwrite", () => {
  const source = "Set my account balance to 2000 without a source record.";
  const p = groundPlanner(
    { ...base, intent: "unsupported", steps: [] },
    source,
  );
  expect(p.intent).toBe("clarify");
  expect(p.steps).toEqual([]);
  expect(p.globalQuestions.length).toBeGreaterThan(0);
});
it("surfaces query clarification questions without creating mutation drafts", () => {
  const source = "Compare my cash count.";
  const p = groundPlanner(
    {
      ...base,
      steps: [
        {
          ...base.steps[0],
          sourceExcerpt: source,
          status: "needs_clarification",
          clarificationQuestions: ["What amount did you count?"],
        },
      ],
    },
    source,
  );
  expect(p.globalQuestions).toContain("What amount did you count?");
  expect(p.steps[0].kind).toBe("query");
});

it("requires a physical count before computing a cash-count difference", () => {
  const source = "My cash count is less than the ledger; show the difference.";
  const p = groundPlanner(
    { ...base, steps: [{ ...base.steps[0], sourceExcerpt: source }] },
    source,
  );
  expect(p.steps[0].kind).toBe("query");
  expect(p.globalQuestions.some((q) => q.includes("cash amount"))).toBe(true);
});
