import { it, expect } from "vitest";
import { normalizeDrafts } from "../../lib/ledger/preview";
import { replayFixtures } from "../../lib/agent/replay";
it("optional metadata questions never override required financial preview checks", () => {
  const f = structuredClone(replayFixtures[1]);
  const context: any = {
    id: "w",
    ownerId: "u",
    revision: 0,
    timezone: "Asia/Kolkata",
    openedOn: "2026-10-01",
    accounts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        label: "Everyday bank",
        kind: "bank",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "Cash wallet",
        kind: "cash",
      },
    ],
    contacts: [],
    claims: [],
    bills: [],
    entries: [],
    balances: {},
    defaults: {},
    closedDays: [],
  };
  f.writer.drafts[0].unresolvedFields = ["paymentMethod"];
  const ready = normalizeDrafts(
    f.writer,
    context,
    "2026-11-05T16:00:00Z",
    f.planner,
  );
  expect(ready.issues).toEqual([]);
  expect(ready.actions).toHaveLength(1);
  f.writer.drafts[0].unresolvedFields.push("accountAlias");
  const blocked = normalizeDrafts(
    f.writer,
    context,
    "2026-11-05T16:00:00Z",
    f.planner,
  );
  expect(blocked.issues.some((i) => i.field === "accountAlias")).toBe(true);
});

it("an unpaid bill does not require a payment account or counterparty", () => {
  const context: any = {
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
  const writer: any = {
    schemaVersion: "2.1",
    promptVersion: "daybook-writer-v2.1",
    drafts: [
      {
        stepRef: "s1",
        kind: "create_bill",
        fields: {
          amountText: "300",
          bookedOnText: "today",
          dueOnText: "2026-12-01",
          accountAlias: null,
          counterpartyAlias: null,
          paymentMethod: null,
          categoryHint: null,
          description: "Synthetic unpaid bill",
        },
        evidence: {},
        unresolvedFields: ["accountAlias", "counterpartyAlias"],
        questions: [],
      },
    ],
    rejectedSteps: [],
  };
  const plan: any = {
    steps: [
      {
        stepRef: "s1",
        kind: "create_bill",
        status: "proposed",
        dependsOn: [],
        clarificationQuestions: [],
      },
    ],
    globalQuestions: [],
  };
  const result = normalizeDrafts(writer, context, "2026-11-05T16:00:00Z", plan);
  expect(result.issues).toEqual([]);
  expect(result.actions).toHaveLength(1);
  writer.drafts[0].fields.dueOnText = null;
  expect(
    normalizeDrafts(writer, context, "2026-11-05T16:00:00Z", plan).issues
      .length,
  ).toBeGreaterThan(0);
});
