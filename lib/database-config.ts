import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolConfig } from "pg";
import { DomainError } from "./errors";

/** Database secrets stay in memory; invalid values are never reflected in errors. */
export function databasePoolConfig(raw = process.env.DATABASE_URL): PoolConfig {
  if (!raw) throw new DomainError("DATABASE_NOT_CONFIGURED", 503);
  let url: URL;
  try {
    url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
      throw new Error("Invalid database endpoint");
  } catch {
    throw new DomainError(
      "DATABASE_CONFIGURATION_ERROR",
      503,
      "The ledger database connection is not configured correctly. Contact the app administrator.",
    );
  }
  const config: PoolConfig = {
    connectionString: raw,
    max: 5,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
    idleTimeoutMillis: 10000,
  };
  const supabase =
    url.hostname.endsWith(".pooler.supabase.com") ||
    /^db\.[a-z0-9]+\.supabase\.co$/i.test(url.hostname);
  if (supabase) {
    if (
      ["disable", "no-verify"].includes(
        url.searchParams.get("sslmode") ?? "",
      ) ||
      ["false", "0"].includes(url.searchParams.get("ssl") ?? "") ||
      ["sslcert", "sslkey", "sslrootcert"].some((name) =>
        url.searchParams.has(name),
      )
    )
      throw new DomainError("DATABASE_TLS_CONFIGURATION_ERROR", 503);
    // pg's connection-string SSL options replace its explicit SSL object.
    // Remove those options so the bundled CA and hostname checks remain active.
    for (const name of ["sslmode", "ssl", "uselibpqcompat"])
      url.searchParams.delete(name);
    try {
      config.ssl = {
        ca: readFileSync(
          join(process.cwd(), "certs", "supabase-root-2021.crt"),
          "utf8",
        ),
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      };
    } catch {
      throw new DomainError("DATABASE_TLS_CONFIGURATION_ERROR", 503);
    }
    config.connectionString = url.toString();
  }
  return config;
}
