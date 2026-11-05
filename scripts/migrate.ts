import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { PGlite } from "@electric-sql/pglite";
const url = process.env.DATABASE_URL;
const local =
  process.env.LOCAL_DEMO_ENABLED === "true" &&
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_DATABASE_PATH;
if (!url && !local)
  throw new Error("Set DATABASE_URL to a dedicated empty demo database.");
const raw = local
  ? new PGlite(process.env.LOCAL_DATABASE_PATH)
  : new Client({ connectionString: url });
if (raw instanceof Client) await raw.connect();
else await raw.waitReady;
const db = {
  query: async (sql: string, args?: unknown[]) =>
    raw instanceof Client ? raw.query(sql, args) : raw.query(sql, args),
  end: async () => (raw instanceof Client ? raw.end() : raw.close()),
};
// Local bootstrap only. Supabase already owns auth.uid()/roles; never replace its auth schema.
if (
  process.env.LOCAL_DEMO_ENABLED === "true" &&
  process.env.NODE_ENV !== "production"
) {
  const bootstrap = `create schema if not exists auth;
  do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon nologin;end if;
  if not exists(select from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;end$$;
  create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`;
  if (raw instanceof PGlite) await raw.exec(bootstrap);
  else await db.query(bootstrap);
}
await db.query("create schema if not exists private");
await db.query(
  "create table if not exists private.schema_migrations(name text primary key,applied_at timestamptz default now())",
);
for (const file of (await readdir("supabase/migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort()) {
  if (
    (
      await db.query(
        "select name from private.schema_migrations where name=$1",
        [file],
      )
    ).rows.length
  )
    continue;
  await db.query("begin");
  try {
    const sql = await readFile(`supabase/migrations/${file}`, "utf8");
    if (raw instanceof PGlite) await raw.exec(sql);
    else await db.query(sql);
    await db.query("insert into private.schema_migrations(name)values($1)", [
      file,
    ]);
    await db.query("commit");
    console.log(`Applied ${file}`);
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
await db.end();
