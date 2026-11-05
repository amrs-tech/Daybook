import { PGlite } from "@electric-sql/pglite";
import { DomainError } from "./errors";
const state = globalThis as unknown as { daybookLocal?: Promise<PGlite> };
export async function localDatabase(): Promise<PGlite> {
  if (
    process.env.LOCAL_DEMO_ENABLED !== "true" ||
    process.env.NODE_ENV === "production"
  )
    throw new DomainError("LOCAL_DATABASE_DISABLED", 403);
  return (state.daybookLocal ??= (async () => {
    const db = new PGlite(process.env.LOCAL_DATABASE_PATH ?? ".local/daybook");
    await db.waitReady;
    return db;
  })());
}
