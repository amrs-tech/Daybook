import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import {
  setup,
  fresh,
  prepare,
  commit,
  expense,
  context,
  account,
  today,
  read,
} from "./setup";
import { rpc } from "../../lib/db";
import type { Draft } from "../../lib/workflow";
let db: PGlite;
beforeAll(async () => {
  db = await setup();
});
afterAll(async () => {
  await db.close();
});
it("source confirmation deduplicates exact replay, conflicts on changed text", async () => {
  const { owner, context: c } = await fresh(),
    key = randomUUID();
  const args = [c.id, key, "Confirmed source", "text", null, null];
  const a = await rpc<{ id: string }>(owner, "capture_source", args),
    b = await rpc<{ id: string }>(owner, "capture_source", args);
  expect(a.id).toBe(b.id);
  await expect(
    rpc(owner, "capture_source", [
      c.id,
      key,
      "Changed source",
      "text",
      null,
      null,
    ]),
  ).rejects.toMatchObject({ status: 409 });
});
it("F source edits keep original reference instant and invalidate the prior preview", async () => {
  const { owner, context: c } = await fresh();
  const d = await prepare(owner, c, [expense(c)]);
  const original = (
    await read(
      owner,
      "select reference_instant from public.sources where id=$1",
      [d.source_id],
    )
  )[0];
  const next = await rpc<{ version: number; reference_instant: string }>(
    owner,
    "capture_source",
    [
      c.id,
      randomUUID(),
      "Corrected confirmed source",
      "text",
      d.source_id,
      null,
    ],
  );
  expect(next.version).toBe(2);
  expect(new Date(next.reference_instant).getTime()).toBe(
    new Date(original.reference_instant).getTime(),
  );
  await expect(commit(owner, d)).rejects.toMatchObject({ status: 409 });
});
it("voice source requires a prior owned persisted transcription", async () => {
  const { owner, context: c } = await fresh();
  await expect(
    rpc(owner, "capture_source", [
      c.id,
      randomUUID(),
      "unverified words",
      "voice",
      null,
      randomUUID(),
    ]),
  ).rejects.toThrow("TRANSCRIPT_CONFIRMATION_REQUIRED");
});
it("edited form invalidates old hash/version; stale approval cannot post", async () => {
  const { owner, context: c } = await fresh();
  const d = await prepare(owner, c, [expense(c)]);
  const updated = await rpc<Draft>(owner, "edit_draft", [
    c.id,
    d.id,
    d.version,
    JSON.stringify(d.writer),
    "[]",
    false,
  ]);
  expect(updated.version).toBe(2);
  expect(updated.preview).toBeNull();
  await expect(commit(owner, d)).rejects.toMatchObject({ status: 409 });
});
it("private preview has a 15 minute approval expiry", async () => {
  const { owner, context: c } = await fresh();
  const d = await prepare(owner, c, [expense(c)]);
  await db.query(
    "update public.drafts set previewed_at=now()-interval '16 minutes' where id=$1",
    [d.id],
  );
  await expect(commit(owner, d)).rejects.toMatchObject({ status: 409 });
});
it("daily owner provider cap survives resetting the demo workspace", async () => {
  const { owner, context: c } = await fresh();
  await rpc(owner, "reserve_usage", [c.id, "model", 60, 0, 0]);
  const w = await rpc<string>(owner, "reset_demo", [c.id, true]);
  await expect(
    rpc(owner, "reserve_usage", [w, "model", 1, 0, 0]),
  ).rejects.toMatchObject({ status: 429 });
});
it("transcription leases reject a parallel owner call", async () => {
  const { owner, context: c } = await fresh();
  await rpc(owner, "reserve_usage", [c.id, "voice", 1, 32000, 1000]);
  await expect(
    rpc(owner, "reserve_usage", [c.id, "voice", 1, 32000, 1000]),
  ).rejects.toThrow("VOICE_BUSY");
});
it("source planning dedup reuses the same run independently of commit idempotency", async () => {
  const { owner, context: c } = await fresh();
  const source = await rpc<{ id: string }>(owner, "capture_source", [
    c.id,
    randomUUID(),
    "Confirmed input",
    "text",
    null,
    null,
  ]);
  const request = randomUUID(),
    run = randomUUID();
  const a = await rpc<{ id: string }>(owner, "begin_run", [
    c.id,
    source.id,
    request,
    run,
    randomUUID(),
    "test",
  ]);
  const b = await rpc<{ id: string }>(owner, "begin_run", [
    c.id,
    source.id,
    randomUUID(),
    randomUUID(),
    randomUUID(),
    "test",
  ]);
  expect(a.id).toBe(b.id);
});
it("bill payment undo reopens bill and removes personal spending exactly", async () => {
  const { owner, context: c } = await fresh(),
    billId = randomUUID();
  await commit(
    owner,
    await prepare(owner, c, [
      {
        kind: "create_bill",
        stepRef: "s1",
        bookedOn: today(),
        description: "Utility",
        amount: "40000",
        dueOn: today(),
        billId,
      },
    ]),
  );
  let current = await context(owner, c.id);
  const paid = await commit(
    owner,
    await prepare(owner, current, [
      {
        kind: "pay_bill",
        stepRef: "s1",
        bookedOn: today(),
        description: "Utility paid",
        amount: "40000",
        accountId: account(c, "bank"),
        billId,
      },
    ]),
  );
  current = await context(owner, c.id);
  await commit(
    owner,
    await prepare(owner, current, [
      {
        kind: "undo",
        stepRef: "s1",
        bookedOn: today(),
        description: "Undo utility payment",
        targetId: paid.entry_ids[0],
      },
    ]),
  );
  const after = await context(owner, c.id);
  expect(after.bills[0].paid).toBe(false);
  expect(after.balances[account(c, "expense")]).toBe(
    c.balances[account(c, "expense")],
  );
});
it("a failed later action rolls back all earlier actions in the reviewed batch", async () => {
  const { owner, context: c } = await fresh();
  const d = await prepare(owner, c, [
    expense(c, "10000", "s1"),
    { ...expense(c, "900000", "s2"), accountId: account(c, "cash") },
  ]);
  await expect(commit(owner, d)).rejects.toThrow("HISTORICAL_CASH_NEGATIVE");
  expect((await context(owner, c.id)).entries.length).toBe(7);
  expect(
    (
      await read(owner, "select id from public.receipts where draft_id=$1", [
        d.id,
      ])
    ).length,
  ).toBe(0);
});
it("T22 day-close snapshots survive explicit reopen, backdated posting and reclose", async () => {
  const { owner, context: c } = await fresh();
  const original = await rpc<{ id: string; snapshot: unknown }>(
    owner,
    "close_day",
    [c.id, today(), true],
  );
  let current = await context(owner, c.id);
  const blocked = await prepare(owner, current, [expense(current)]);
  expect(
    blocked.preview!.issues.some(
      (i) => i.code === "CLOSED_DAY_REVIEW_REQUIRED",
    ),
  ).toBe(true);
  await expect(commit(owner, blocked)).rejects.toThrow();
  await rpc(owner, "reopen_day", [
    c.id,
    today(),
    "Explicit test review of backdated expense",
    true,
  ]);
  current = await context(owner, c.id);
  expect(current.closedDays).toEqual([]);
  await commit(owner, await prepare(owner, current, [expense(current)]));
  const next = await rpc<{ id: string; snapshot: unknown }>(
    owner,
    "close_day",
    [c.id, today(), true],
  );
  expect(next.id).not.toBe(original.id);
  expect(next.snapshot).not.toEqual(original.snapshot);
  const retained = await read(
    owner,
    "select snapshot from public.day_closes where id=$1",
    [original.id],
  );
  expect(retained[0].snapshot).toEqual(original.snapshot);
});
it("T35 zero counted-cash discrepancy stays unresolved in the immutable close snapshot", async () => {
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
  const result = await rpc<{
    snapshot: { cashObservations: { difference: string; status: string }[] };
  }>(owner, "close_day", [c.id, today(), true]);
  expect(result.snapshot.cashObservations[0]).toMatchObject({
    difference: "-380000",
    status: "unresolved",
  });
  expect((await context(owner, c.id)).entries.length).toBe(7);
});
