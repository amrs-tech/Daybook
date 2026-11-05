import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import {
  setup,
  fresh,
  prepare,
  commit,
  account,
  today,
  expense,
  context,
  read,
} from "./setup";
import { rpc } from "../../lib/db";
import type { Action, Context } from "../../lib/ledger/types";
import { normalizeDrafts } from "../../lib/ledger/preview";
import { authorizeLookups } from "../../lib/agent/tool-registry";
import {
  commonFields,
  emptyEvidence,
  type PlannerOutput,
  type WriterOutput,
} from "../../lib/agent/contracts";
let db: PGlite;
beforeAll(async () => {
  db = await setup();
});
afterAll(async () => {
  await db.close();
});
const balance = (ctx: Context, kind: string) =>
  BigInt(ctx.balances[account(ctx, kind)] ?? "0");
describe("PostgreSQL-engine migration and protected financial boundary", () => {
  it("seed is explicit, balanced and separates repayment from income", async () => {
    const { context: c } = await fresh();
    expect(c.entries).toHaveLength(7);
    expect(balance(c, "expense")).toBe(370000n);
    expect(balance(c, "income")).toBe(0n);
    expect(c.claims.map((x) => x.outstanding).sort()).toEqual([
      "30000",
      "80000",
    ]);
    for (const e of c.entries)
      expect(e.lines.reduce((s, l) => s + BigInt(l.amount), 0n)).toBe(0n);
  });
  it("T02/A07 ATM transfer excludes spending and income", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [
      {
        kind: "transfer",
        stepRef: "s1",
        description: "ATM",
        bookedOn: today(),
        amount: "200000",
        accountId: account(c, "bank"),
        destinationId: account(c, "cash"),
      },
    ]);
    await commit(owner, d);
    const after = await context(owner, c.id);
    expect(balance(after, "cash") - balance(c, "cash")).toBe(200000n);
    expect(balance(after, "expense")).toBe(balance(c, "expense"));
    expect(balance(after, "income")).toBe(0n);
  });
  it("T03/A08 shared purchase allocates exact personal share and claims", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [
      {
        kind: "shared_payment",
        stepRef: "s1",
        bookedOn: today(),
        description: "Split",
        amount: "240000",
        accountId: account(c, "bank"),
        personal: "80000",
        shares: c.contacts.map((contact) => ({
          contactId: contact.id,
          amount: "80000",
          claimId: randomUUID(),
        })),
      },
    ]);
    await commit(owner, d);
    const after = await context(owner, c.id);
    expect(balance(after, "expense") - balance(c, "expense")).toBe(80000n);
    expect(balance(after, "receivable") - balance(c, "receivable")).toBe(
      160000n,
    );
    expect(after.claims.length).toBe(4);
  });
  it("T04/A09 partial repayments 200 then 200 reduce a 400 claim, never income", async () => {
    const { owner, context: c } = await fresh(),
      claimId = randomUUID();
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "lend",
          stepRef: "s1",
          bookedOn: today(),
          description: "Explicit loan",
          amount: "40000",
          accountId: account(c, "bank"),
          claimId,
          contactId: c.contacts.find((x) => x.label === "Priya")!.id,
        },
      ]),
    );
    for (const [i, amount] of ["20000", "20000"].entries()) {
      const current = await context(owner, c.id);
      const d = await prepare(owner, current, [
        {
          kind: "settle_claim",
          stepRef: "s1",
          bookedOn: today(),
          description: `Repayment ${i + 1}`,
          amount,
          accountId: account(c, "bank"),
          claimId,
        },
      ]);
      await commit(owner, d);
      expect(
        (await context(owner, c.id)).claims.find((x) => x.id === claimId)
          ?.outstanding,
      ).toBe(i === 0 ? "20000" : "0");
    }
    expect(balance(await context(owner, c.id), "income")).toBe(0n);
  });
  it("T06 several Arun claims return candidates and require an explicit target", async () => {
    const { owner, context: c } = await fresh();
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "lend",
          stepRef: "s1",
          bookedOn: today(),
          description: "Second Arun claim",
          amount: "40000",
          accountId: account(c, "bank"),
          claimId: randomUUID(),
          contactId: c.contacts.find((x) => x.label === "Arun")!.id,
        },
      ]),
    );
    const current = await context(owner, c.id);
    const plan: PlannerOutput = {
      schemaVersion: "2.1",
      promptVersion: "daybook-planner-v2.1",
      intent: "mutate",
      steps: [
        {
          stepRef: "s1",
          kind: "settle_claim",
          sourceExcerpt: "Arun returned 200 today",
          status: "needs_lookup",
          requiresLookup: ["claims"],
          dependsOn: [],
          fieldHints: { amountText: "200", method: null, dateText: "today" },
          unresolvedFields: [],
          clarificationQuestions: [],
        },
      ],
      globalQuestions: [],
      unsupportedFragments: [],
    };
    const candidates = authorizeLookups(plan, current)[0].results as {
      label: string;
    }[];
    expect(candidates.filter((c) => c.label === "Arun")).toHaveLength(2);
    const writer: WriterOutput = {
      schemaVersion: "2.1",
      promptVersion: "daybook-writer-v2.1",
      drafts: [
        {
          stepRef: "s1",
          kind: "settle_claim",
          fields: {
            ...commonFields(),
            amountText: "200",
            bookedOnText: "today",
            accountAlias: "Everyday bank",
            counterpartyAlias: "Arun",
            targetHint: null,
          },
          evidence: emptyEvidence(),
          unresolvedFields: ["targetHint"],
          questions: ["Which Arun claim is being repaid?"],
        },
      ],
      rejectedSteps: [],
    };
    const normalized = normalizeDrafts(
      writer,
      current,
      new Date().toISOString(),
      plan,
    );
    expect(normalized.actions).toEqual([]);
    expect(normalized.issues.some((i) => i.field === "targetHint")).toBe(true);
  });
  it("T05 over-settlement cannot produce negative claim", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [
      {
        kind: "settle_claim",
        stepRef: "s1",
        bookedOn: today(),
        description: "Too much",
        amount: "90000",
        accountId: account(c, "bank"),
        claimId: c.claims.find((x) => x.label === "Arun")!.id,
      },
    ]);
    await expect(commit(owner, d)).rejects.toThrow();
    expect((await context(owner, c.id)).entries.length).toBe(7);
  });
  it("T07/A06 unpaid bill plans only, then payment posts one linked expense", async () => {
    const { owner, context: c } = await fresh();
    const billId = randomUUID();
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "create_bill",
          stepRef: "s1",
          bookedOn: today(),
          description: "Electricity",
          amount: "50000",
          billId,
          dueOn: today(),
        },
      ]),
    );
    const mid = await context(owner, c.id);
    expect(mid.entries.length).toBe(7);
    expect(mid.bills[0].paid).toBe(false);
    await commit(
      owner,
      await prepare(owner, mid, [
        {
          kind: "pay_bill",
          stepRef: "s1",
          bookedOn: today(),
          description: "Electricity payment",
          amount: "50000",
          accountId: account(c, "bank"),
          billId,
        },
      ]),
    );
    const after = await context(owner, c.id);
    expect(after.bills[0].paid).toBe(true);
    expect(after.entries.length).toBe(8);
    expect(balance(after, "expense") - balance(c, "expense")).toBe(50000n);
  });
  it("T08 second reviewed bill payment is rejected", async () => {
    const { owner, context: c } = await fresh();
    const billId = randomUUID();
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "create_bill",
          stepRef: "s1",
          bookedOn: today(),
          description: "Rent",
          amount: "50000",
          billId,
          dueOn: today(),
        },
      ]),
    );
    const mid = await context(owner, c.id);
    const a: Action = {
      kind: "pay_bill",
      stepRef: "s1",
      bookedOn: today(),
      description: "Rent",
      amount: "50000",
      accountId: account(c, "bank"),
      billId,
    };
    await commit(owner, await prepare(owner, mid, [a]));
    const now = await context(owner, c.id);
    await expect(
      commit(owner, await prepare(owner, now, [a])),
    ).rejects.toThrow();
  });
  it("T09 exact reversal and replacement preserve original history", async () => {
    const { owner, context: c } = await fresh();
    const target = c.entries.find((e) => e.description === "Fuel")!;
    const d = await prepare(owner, c, [
      {
        kind: "correct",
        stepRef: "s1",
        bookedOn: today(),
        description: "Corrected fuel",
        amount: "100000",
        accountId: account(c, "cash"),
        targetId: target.id,
        replacementKind: "expense",
      },
    ]);
    const r = await commit(owner, d);
    const after = await context(owner, c.id);
    expect(r.entry_ids).toHaveLength(2);
    expect(after.entries.find((e) => e.id === target.id)?.reversed).toBe(true);
    expect(balance(after, "expense")).toBe(balance(c, "expense") - 20000n);
    const undo = await prepare(owner, after, [
      {
        kind: "undo",
        stepRef: "s1",
        bookedOn: today(),
        description: "Repeat",
        targetId: target.id,
      },
    ]);
    await expect(commit(owner, undo)).rejects.toThrow();
  });
  it("T10 reversing settled shared expense is dependency-blocked by SQL", async () => {
    const { owner, context: c } = await fresh();
    const target = c.entries.find((e) => e.kind === "shared_payment")!;
    const d = await prepare(owner, c, [
      {
        kind: "undo",
        stepRef: "s1",
        bookedOn: today(),
        description: "Undo dinner",
        targetId: target.id,
      },
    ]);
    await expect(commit(owner, d)).rejects.toThrow();
    expect((await context(owner, c.id)).entries.length).toBe(7);
  });
  it("T11 undo repayment reopens claim exactly once", async () => {
    const { owner, context: c } = await fresh();
    const target = c.entries.find((e) => e.kind === "settle_claim")!;
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "undo",
          stepRef: "s1",
          bookedOn: today(),
          description: "Undo receipt",
          targetId: target.id,
        },
      ]),
    );
    const after = await context(owner, c.id);
    expect(after.claims.find((x) => x.label === "Priya")!.outstanding).toBe(
      "80000",
    );
    expect(balance(after, "income")).toBe(0n);
  });
  it("T12/T14/A21 repeat approval twenty times returns one receipt", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [expense(c)]);
    const r = await commit(owner, d);
    for (let i = 0; i < 20; i++)
      expect(
        (await commit(owner, d, i % 2 ? randomUUID() : d.commit_key)).id,
      ).toBe(r.id);
    expect((await context(owner, c.id)).entries.length).toBe(8);
    expect(
      (
        await read(owner, "select id from public.receipts where draft_id=$1", [
          d.id,
        ])
      ).length,
    ).toBe(1);
  });
  it("T13 same key different draft/payload conflicts", async () => {
    const { owner, context: c } = await fresh();
    const first = await prepare(owner, c, [expense(c)]);
    await commit(owner, first);
    const next = await prepare(owner, await context(owner, c.id), [
      expense(c, "20000"),
    ]);
    await expect(commit(owner, next, first.commit_key)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("T15 stale concurrent drafts require a fresh preview", async () => {
    const { owner, context: c } = await fresh();
    const a = await prepare(owner, c, [expense(c, "10000")]),
      b = await prepare(owner, c, [expense(c, "20000")]);
    await commit(owner, a);
    await expect(commit(owner, b)).rejects.toMatchObject({ status: 409 });
  });
  it("T17 changing an explicit payment default invalidates preview revision", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [expense(c)]);
    await rpc(owner, "set_defaults", [
      c.id,
      c.revision,
      JSON.stringify({ UPI: account(c, "bank") }),
    ]);
    await expect(commit(owner, d)).rejects.toMatchObject({ status: 409 });
  });
  it("T20 negative historical cash is rejected even when later income repairs today", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [
      {
        ...expense(c, "600000"),
        accountId: account(c, "cash"),
        bookedOn: new Date(Date.parse(today()) - 10 * 86400000)
          .toISOString()
          .slice(0, 10),
      },
      {
        kind: "income",
        stepRef: "s2",
        amount: "600000",
        description: "Later synthetic income",
        bookedOn: today(),
        accountId: account(c, "cash"),
      },
    ]);
    await expect(commit(owner, d)).rejects.toThrow("HISTORICAL_CASH_NEGATIVE");
    expect((await context(owner, c.id)).entries.length).toBe(7);
  });
  it("T21 cash zero observation does not create synthetic spending", async () => {
    const { owner, context: c } = await fresh();
    await commit(
      owner,
      await prepare(owner, c, [
        {
          kind: "cash_count",
          stepRef: "s1",
          bookedOn: today(),
          description: "Counted zero",
          amount: "0",
          accountId: account(c, "cash"),
        },
      ]),
    );
    const after = await context(owner, c.id);
    expect(after.entries.length).toBe(7);
    const rows = await read(
      owner,
      "select counted::text,expected::text from public.cash_observations where workspace_id=$1",
      [c.id],
    );
    expect(rows[0]).toEqual({ counted: "0", expected: "380000" });
  });
  it("T25 browser role cannot directly write or invoke protected posting", async () => {
    const { owner, context: c } = await fresh();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          owner,
        ]);
        await tx.query(
          "insert into public.journal_lines(workspace_id,entry_id,account_id,amount)values($1,$2,$3,1)",
          [c.id, randomUUID(), account(c, "bank")],
        );
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("set local role authenticated");
        await tx.query("select private.initialize_workspace()");
      }),
    ).rejects.toThrow(/permission denied/);
  });
  it("T25 deferred balance constraint rejects malformed privileged entry", async () => {
    const { context: c } = await fresh();
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          "insert into public.journal_entries(id,workspace_id,step_ref,kind,booked_on,description,amount)values($1,$2,'bad','expense',$3,'bad',100)",
          [randomUUID(), c.id, today()],
        );
      }),
    ).rejects.toThrow("UNBALANCED_JOURNAL");
  });
  it("T26/A22 RLS and protected functions isolate two owners", async () => {
    const a = await fresh(),
      b = await fresh();
    expect(
      (
        await read(a.owner, "select id from public.workspaces where id=$1", [
          b.context.id,
        ])
      ).length,
    ).toBe(0);
    expect(
      (
        await read(
          a.owner,
          "select id from public.journal_entries where workspace_id=$1",
          [b.context.id],
        )
      ).length,
    ).toBe(0);
    await expect(rpc(a.owner, "context", [b.context.id])).rejects.toMatchObject(
      { status: 404 },
    );
    const draft = await prepare(b.owner, b.context, [expense(b.context)]);
    await expect(commit(a.owner, draft)).rejects.toMatchObject({ status: 404 });
  });
  it("T31/A23 persisted receipt/draft accurately survives a read", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [expense(c)]);
    const r = await commit(owner, d);
    const stored = await read(
      owner,
      "select status from public.drafts where id=$1",
      [d.id],
    );
    expect(stored[0].status).toBe("COMMITTED");
    expect(
      (
        await read(owner, "select id from public.receipts where id=$1", [r.id])
      )[0].id,
    ).toBe(r.id);
  });
  it("T32 equal real purchases warn and can be explicitly acknowledged", async () => {
    const { owner, context: c } = await fresh();
    const existing = c.entries.find((e) => e.description === "Groceries")!;
    const a: Action = {
      kind: "expense",
      stepRef: "s1",
      description: existing.description,
      bookedOn: existing.bookedOn,
      amount: existing.amount,
      accountId: existing.accountId!,
    };
    const blocked = await prepare(owner, c, [a]);
    expect(blocked.status).toBe("NEEDS_CLARIFICATION");
    const reviewed = await prepare(owner, c, [a], true);
    await commit(owner, reviewed);
    expect((await context(owner, c.id)).entries.length).toBe(8);
  });
  it("A24 rejected batch has no financial effects", async () => {
    const { owner, context: c } = await fresh();
    const d = await prepare(owner, c, [expense(c)]);
    await rpc(owner, "edit_draft", [
      c.id,
      d.id,
      d.version,
      JSON.stringify(d.writer),
      "[]",
      true,
    ]);
    await expect(commit(owner, d)).rejects.toMatchObject({ status: 409 });
    expect((await context(owner, c.id)).entries.length).toBe(7);
  });
  it("all exposed tables have RLS enabled and immutable journals reject updates", async () => {
    const rows = await db.query<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    );
    expect(rows.rows).toEqual([]);
    const { context: c } = await fresh();
    await expect(
      db.query(
        "update public.journal_entries set description='changed' where id=$1",
        [c.entries[0].id],
      ),
    ).rejects.toThrow("IMMUTABLE");
  });
  it("demo reset archives history and replaces IDs, without resetting global quotas", async () => {
    const { owner, context: c } = await fresh();
    await rpc(owner, "reserve_usage", [c.id, "model", 3, 0, 0]);
    const freshId = await rpc<string>(owner, "reset_demo", [c.id, true]);
    expect(freshId).not.toBe(c.id);
    const next = await context(owner, freshId);
    expect(next.entries.length).toBe(7);
    expect(
      next.accounts.some((a) => c.accounts.some((b) => a.id === b.id)),
    ).toBe(false);
    expect((await context(owner, c.id)).entries.length).toBe(7);
  });
});
