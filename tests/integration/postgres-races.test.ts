import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { makePreview } from "../../lib/ledger/preview";
import type { Context, Action } from "../../lib/ledger/types";
import type { Draft } from "../../lib/workflow";
// Opt-in ONLY: use a dedicated disposable PostgreSQL database; never a personal/live project.
const enabled =
  !!process.env.TEST_DATABASE_URL &&
  process.env.TEST_DATABASE_DEDICATED === "true";
describe.skipIf(!enabled)("real PostgreSQL independent-session races", () => {
  let admin: Client;
  const clients: Client[] = [];
  async function session() {
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await client.connect();
    clients.push(client);
    return client;
  }
  async function call<T>(
    client: Client,
    owner: string,
    name: string,
    args: unknown[] = [],
  ): Promise<T> {
    await client.query("begin");
    try {
      await client.query("set local role daybook_server");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        owner,
      ]);
      const r = await client.query(
        `select private.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      );
      await client.query("commit");
      return r.rows[0].result;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  beforeAll(async () => {
    admin = await session();
    const tables = await admin.query(
      "select to_regclass('public.workspaces') existing",
    );
    if (!tables.rows[0].existing) {
      await admin.query(
        `create schema if not exists auth;do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon nologin;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;end$$;create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
      );
      for (const f of (await readdir("supabase/migrations"))
        .filter((x) => x.endsWith(".sql"))
        .sort())
        await admin.query(await readFile(`supabase/migrations/${f}`, "utf8"));
    }
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end()));
  });
  async function fresh() {
    const owner = randomUUID(),
      w = await call<string>(admin, owner, "initialize_workspace");
    await call(admin, owner, "seed_demo", [w]);
    return { owner, c: await call<Context>(admin, owner, "context", [w]) };
  }
  async function prepared(owner: string, c: Context, actions: Action[]) {
    const source = await call<{ id: string }>(admin, owner, "capture_source", [
      c.id,
      randomUUID(),
      "Explicit synthetic PostgreSQL race fixture",
      "text",
      null,
      null,
    ]);
    const run = await call<{ id: string }>(admin, owner, "begin_run", [
      c.id,
      source.id,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      "synthetic-db-fixture",
    ]);
    const d = await call<Draft>(admin, owner, "store_draft", [
      c.id,
      randomUUID(),
      source.id,
      run.id,
      "{}",
      "{}",
    ]);
    await call(admin, owner, "finish_run", [
      c.id,
      run.id,
      "DRAFT_READY",
      "{}",
      null,
      "[]",
    ]);
    return call<Draft>(admin, owner, "save_preview", [
      c.id,
      d.id,
      1,
      c.revision,
      JSON.stringify(makePreview(actions, c, 1, 1, true)),
    ]);
  }
  const day = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const approve = (client: Client, owner: string, d: Draft) =>
    call<{ id: string }>(client, owner, "commit_batch", [
      d.workspace_id,
      d.id,
      d.version,
      d.preview!.planHash,
      d.preview!.revision,
      d.commit_key,
      true,
    ]);
  it("twenty simultaneous approvals produce a single receipt", async () => {
    const { owner, c } = await fresh();
    const d = await prepared(owner, c, [
      {
        kind: "expense",
        stepRef: "s1",
        bookedOn: day(),
        description: "Race",
        amount: "10000",
        accountId: c.accounts.find((a) => a.kind === "bank")!.id,
      },
    ]);
    const connections = await Promise.all(
      Array.from({ length: 20 }, () => session()),
    );
    const results = await Promise.all(
      connections.map((client) => approve(client, owner, d)),
    );
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
  });
  it("independent stale drafts serialize on workspace revision", async () => {
    const { owner, c } = await fresh(),
      a: Action = {
        kind: "expense",
        stepRef: "s1",
        bookedOn: day(),
        description: "Race draft",
        amount: "10000",
        accountId: c.accounts.find((a) => a.kind === "bank")!.id,
      };
    const d1 = await prepared(owner, c, [a]),
      d2 = await prepared(owner, c, [{ ...a, amount: "20000" }]);
    const [s1, s2] = await Promise.all([session(), session()]);
    const results = await Promise.allSettled([
      approve(s1, owner, d1),
      approve(s2, owner, d2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("two competing bill payments create one active payment", async () => {
    const { owner, c } = await fresh(),
      billId = randomUUID();
    await approve(
      admin,
      owner,
      await prepared(owner, c, [
        {
          kind: "create_bill",
          stepRef: "s1",
          bookedOn: day(),
          description: "Race bill",
          amount: "50000",
          dueOn: day(),
          billId,
        },
      ]),
    );
    const current = await call<Context>(admin, owner, "context", [c.id]);
    const a: Action = {
      kind: "pay_bill",
      stepRef: "s1",
      bookedOn: day(),
      description: "Pay race bill",
      amount: "50000",
      accountId: c.accounts.find((a) => a.kind === "bank")!.id,
      billId,
    };
    const d1 = await prepared(owner, current, [a]),
      d2 = await prepared(owner, current, [a]);
    const [s1, s2] = await Promise.all([session(), session()]);
    const results = await Promise.allSettled([
      approve(s1, owner, d1),
      approve(s2, owner, d2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await call<Context>(admin, owner, "context", [c.id]);
    expect(
      after.entries.filter((e) => e.billId === billId && !e.reversed),
    ).toHaveLength(1);
  });
});
