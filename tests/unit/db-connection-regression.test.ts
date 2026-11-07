import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { X509Certificate } from "node:crypto";
import { databasePoolConfig } from "../../lib/database-config";
import { DomainError } from "../../lib/errors";
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    connect = mocks.connect;
  },
}));
import { asOwner, dbError } from "../../lib/db";

beforeEach(() => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://test:synthetic-password@localhost:5432/test",
  );
  vi.stubEnv("LOCAL_DEMO_ENABLED", "false");
  delete (globalThis as any).daybookPool;
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
  mocks.query.mockResolvedValue({ rows: [] });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  delete (globalThis as any).daybookPool;
});

describe("Production database connection failures", () => {
  it("turns malformed password URLs into a safe configuration error", () => {
    let error: any;
    try {
      databasePoolConfig(
        "postgresql://test:synthetic#password@localhost:5432/test",
      );
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      code: "DATABASE_CONFIGURATION_ERROR",
      status: 503,
    });
    expect(error.message).not.toContain("synthetic");
  });
  it("keeps Supabase chain and hostname verification active when URL SSL options are present", () => {
    const config = databasePoolConfig(
      "postgresql://daybook_backend.test:synthetic%23password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(new URL(config.connectionString!).searchParams.has("sslmode")).toBe(
      false,
    );
    const ssl = config.ssl as any;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.checkServerIdentity).toBeUndefined();
    expect(ssl.minVersion).toBe("TLSv1.2");
    expect(new X509Certificate(ssl.ca).subject).toContain(
      "Supabase Root 2021 CA",
    );
  });
  it.each([
    "sslmode=disable",
    "sslmode=no-verify",
    "ssl=false",
    "sslrootcert=untrusted.crt",
  ])(
    "rejects an insecure or conflicting Supabase SSL override: %s",
    (query) => {
      expect(() =>
        databasePoolConfig(
          "postgresql://u:p@aws-0-region.pooler.supabase.com:6543/postgres?" +
            query,
        ),
      ).toThrow("DATABASE_TLS_CONFIGURATION_ERROR");
    },
  );
  it("does not change local PostgreSQL TLS settings", () => {
    expect(
      databasePoolConfig("postgresql://u:p@localhost:5432/test").ssl,
    ).toBeUndefined();
  });
  it("maps pool connection failures before a transaction starts", async () => {
    mocks.connect.mockRejectedValueOnce(
      Object.assign(new Error("sensitive connection detail"), {
        code: "ECONNREFUSED",
      }),
    );
    await expect(asOwner("owner", async () => 1)).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("commits and releases a healthy client once", async () => {
    await expect(asOwner("owner", async () => "result")).resolves.toBe(
      "result",
    );
    expect(mocks.query.mock.calls.map((c) => c[0])).toEqual([
      "begin",
      "set local role daybook_server",
      "select set_config('request.jwt.claim.sub',$1,true)",
      "commit",
    ]);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it("preserves the original error and discards a client when rollback also fails", async () => {
    const rollback = new Error("connection lost");
    mocks.query.mockImplementation(async (sql) => {
      if (sql === "rollback") throw rollback;
      return { rows: [] };
    });
    const original = new DomainError("ORIGINAL_BUSINESS_ERROR", 409);
    await expect(
      asOwner("owner", async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(rollback);
  });
  it("discards a client if BEGIN fails", async () => {
    const lost = new Error("disconnected");
    mocks.query.mockRejectedValueOnce(lost);
    await expect(asOwner("owner", async () => 1)).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(lost);
  });
  it("uses safe server-database errors for TLS and password failures", () => {
    expect(
      dbError(
        Object.assign(new Error("secret endpoint"), {
          code: "SELF_SIGNED_CERT_IN_CHAIN",
        }),
      ),
    ).toMatchObject({ code: "DATABASE_TLS_ERROR", status: 503 });
    expect(
      dbError(Object.assign(new Error("secret password"), { code: "28P01" })),
    ).toMatchObject({ code: "DATABASE_CONNECTION_AUTH_FAILED", status: 503 });
  });
});
