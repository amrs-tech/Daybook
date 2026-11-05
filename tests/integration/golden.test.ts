import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { setup, prepare, commit, context, account, today } from "./setup";
import { rpc } from "../../lib/db";
import type { Action, Context } from "../../lib/ledger/types";
let db: PGlite;
beforeAll(async () => {
  db = await setup();
});
afterAll(async () => {
  await db.close();
});
it("T01 documented five-group golden narrative posts exact canonical values atomically", async () => {
  const owner = randomUUID(),
    w = await rpc<string>(owner, "initialize_workspace");
  let c = await context(owner, w);
  // Explicit synthetic openings are balanced against equity; no inferred earned income.
  const bank = account(c, "bank"),
    cash = account(c, "cash"),
    equity = account(c, "equity");
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      owner,
    ]);
    await tx.query(
      "select private.add_entry($1,null,'opening-bank','opening',$2,'Explicit synthetic opening',2500000,$3,private.make_lines($3,2500000,$4))",
      [w, today(), bank, equity],
    );
    await tx.query(
      "select private.add_entry($1,null,'opening-cash','opening',$2,'Explicit synthetic opening',500000,$3,private.make_lines($3,500000,$4))",
      [w, today(), cash, equity],
    );
  });
  c = await context(owner, w);
  const arun = c.contacts.find((x) => x.label === "Arun")!,
    priya = c.contacts.find((x) => x.label === "Priya")!,
    arunClaim = randomUUID(),
    priyaClaim = randomUUID();
  const actions: Action[] = [
    {
      kind: "expense",
      stepRef: "s1",
      bookedOn: today(),
      description: "Groceries",
      amount: "85000",
      accountId: bank,
    },
    {
      kind: "expense",
      stepRef: "s2",
      bookedOn: today(),
      description: "Fuel",
      amount: "120000",
      accountId: cash,
    },
    {
      kind: "transfer",
      stepRef: "s3",
      bookedOn: today(),
      description: "ATM",
      amount: "200000",
      accountId: bank,
      destinationId: cash,
    },
    {
      kind: "shared_payment",
      stepRef: "s4",
      bookedOn: today(),
      description: "Team dinner",
      amount: "240000",
      accountId: bank,
      personal: "80000",
      shares: [
        { contactId: arun.id, amount: "80000", claimId: arunClaim },
        { contactId: priya.id, amount: "80000", claimId: priyaClaim },
      ],
    },
    {
      kind: "settle_claim",
      stepRef: "s5",
      bookedOn: today(),
      description: "Priya returned part of dinner",
      amount: "50000",
      accountId: bank,
      claimId: priyaClaim,
    },
    {
      kind: "create_bill",
      stepRef: "s6",
      bookedOn: today(),
      description: "Electricity unpaid",
      amount: "150000",
      dueOn: today(),
      billId: randomUUID(),
    },
  ];
  const d = await prepare(owner, c, actions),
    r = await commit(owner, d),
    after = await context(owner, w);
  expect(r.entry_ids.length).toBe(5);
  expect(after.balances[bank]).toBe("2025000");
  expect(after.balances[cash]).toBe("580000");
  expect(after.balances[account(c, "expense")]).toBe("285000");
  expect(after.balances[account(c, "income")]).toBe("0");
  expect(after.claims.map((c) => c.outstanding).sort()).toEqual([
    "30000",
    "80000",
  ]);
  expect(after.bills[0]).toMatchObject({ amount: "150000", paid: false });
});
