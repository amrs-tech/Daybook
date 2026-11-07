import { Pool, type PoolClient } from "pg";
import { DomainError } from "./errors";
import { databasePoolConfig } from "./database-config";
const globalDb = globalThis as unknown as { daybookPool?: Pool };
export async function localDatabase() {
  const { localDatabase: load } = await import("./local-database");
  return load();
}
export function pool(): Pool {
  return (globalDb.daybookPool ??= new Pool(databasePoolConfig()));
}
/** Only verified server identities enter this transaction; never a body ownerId. */
export async function asOwner<T>(
  ownerId: string,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  if (
    process.env.LOCAL_DEMO_ENABLED === "true" &&
    process.env.NODE_ENV !== "production" &&
    process.env.LOCAL_DATABASE_PATH
  ) {
    const db = await localDatabase();
    return db.transaction(async (tx) => {
      await tx.query("set local role daybook_server");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        ownerId,
      ]);
      try {
        return await fn(tx as unknown as PoolClient);
      } catch (e) {
        throw dbError(e);
      }
    });
  }
  let db: PoolClient | undefined;
  let inTransaction = false;
  let releaseError: Error | undefined;
  try {
    db = await pool().connect();
    await db.query("begin");
    inTransaction = true;
    await db.query("set local role daybook_server");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      ownerId,
    ]);
    const result = await fn(db);
    await db.query("commit");
    inTransaction = false;
    return result;
  } catch (e) {
    if (db) {
      if (inTransaction) {
        try {
          await db.query("rollback");
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error
              ? rollbackError
              : new Error("Database rollback failed");
        }
      } else
        releaseError =
          e instanceof Error
            ? e
            : new Error("Database transaction could not start");
    }
    throw dbError(e);
  } finally {
    db?.release(releaseError);
  }
}
export function dbError(e: unknown): Error {
  if (e instanceof DomainError) return e;
  const x = (e && typeof e === "object" ? e : {}) as {
    code?: string;
    message?: string;
  };
  if (
    [
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(x.code ?? "")
  )
    return new DomainError(
      "DATABASE_TLS_ERROR",
      503,
      "The ledger database connection could not be verified. Contact the app administrator.",
    );
  if (x.code === "28P01")
    return new DomainError(
      "DATABASE_CONNECTION_AUTH_FAILED",
      503,
      "The ledger database credentials need attention. Contact the app administrator.",
    );
  const safe = /^[A-Z][A-Z0-9_]+$/.test(x.message ?? "")
    ? x.message!
    : "DATABASE_OPERATION_FAILED";
  if (x.code === "40001" || x.code === "23505")
    return new DomainError(safe, 409);
  if (x.code === "P0002") return new DomainError("NOT_FOUND", 404);
  if (x.code === "42501" || x.code === "28000")
    return new DomainError("NOT_AUTHORIZED", 403);
  if (x.code === "54000") return new DomainError(safe, 429);
  if (x.code === "23514" || x.code === "23503")
    return new DomainError(safe, 422);
  const error = new DomainError("DATABASE_UNAVAILABLE", 503);
  Object.defineProperty(error, "cause", { value: e });
  return error;
}
export async function rpc<T>(
  ownerId: string,
  name: string,
  args: unknown[] = [],
): Promise<T> {
  // Function names are code constants, never model-controlled tool strings.
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid internal function");
  return asOwner(
    ownerId,
    async (db) =>
      (
        await db.query(
          `select private.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
          args,
        )
      ).rows[0].result as T,
  );
}
