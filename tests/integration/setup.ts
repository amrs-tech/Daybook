import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { rpc, asOwner } from "../../lib/db";
import { makePreview } from "../../lib/ledger/preview";
import type { Action, Context } from "../../lib/ledger/types";
import type { Draft } from "../../lib/workflow";
export async function setup() {
  process.env.LOCAL_DEMO_ENABLED = "true";
  process.env.LOCAL_DATABASE_PATH = "memory://";
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  (globalThis as unknown as { daybookLocal: Promise<PGlite> }).daybookLocal =
    Promise.resolve(db);
  return db;
}
export async function fresh() {
  const owner = randomUUID(),
    w = await rpc<string>(owner, "initialize_workspace");
  await rpc(owner, "seed_demo", [w]);
  return { owner, context: await rpc<Context>(owner, "context", [w]) };
}
export const account = (ctx: Context, kind: string) =>
  ctx.accounts.find((a) => a.kind === kind)!.id;
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function expense(
  ctx: Context,
  amount = "10000",
  stepRef = "s1",
): Extract<Action, { kind: "expense" }> {
  return {
    kind: "expense",
    stepRef,
    bookedOn: today(),
    description: "Synthetic test expense",
    amount,
    accountId: account(ctx, "bank"),
  };
}
export async function prepare(
  owner: string,
  context: Context,
  actions: Action[],
  ack = false,
): Promise<Draft> {
  const source = await rpc<{ id: string; version: number }>(
    owner,
    "capture_source",
    [
      context.id,
      randomUUID(),
      "Synthetic test instruction confirmed by the test reviewer",
      "text",
      null,
      null,
    ],
  );
  const run = await rpc<{ id: string }>(owner, "begin_run", [
    context.id,
    source.id,
    randomUUID(),
    randomUUID(),
    randomUUID(),
    "deterministic-database-fixture",
  ]);
  const d = await rpc<Draft>(owner, "store_draft", [
    context.id,
    randomUUID(),
    source.id,
    run.id,
    JSON.stringify({
      schemaVersion: "2.1",
      promptVersion: "daybook-writer-v2.1",
      drafts: [],
      rejectedSteps: [],
    }),
    JSON.stringify({ steps: [] }),
  ]);
  await rpc(owner, "finish_run", [
    context.id,
    run.id,
    "DRAFT_READY",
    "{}",
    null,
    "[]",
  ]);
  const preview = makePreview(actions, context, 1, 1, ack);
  return rpc<Draft>(owner, "save_preview", [
    context.id,
    d.id,
    1,
    context.revision,
    JSON.stringify(preview),
  ]);
}
export async function commit(owner: string, d: Draft, key = d.commit_key) {
  return rpc<{ id: string; entry_ids: string[]; revision: number }>(
    owner,
    "commit_batch",
    [
      d.workspace_id,
      d.id,
      d.version,
      d.preview!.planHash,
      d.preview!.revision,
      key,
      true,
    ],
  );
}
export async function context(owner: string, w: string) {
  return rpc<Context>(owner, "context", [w]);
}
export async function read(owner: string, sql: string, params: unknown[] = []) {
  return asOwner(owner, async (db) => (await db.query(sql, params)).rows);
}
