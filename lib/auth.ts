import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DomainError, requireThat } from "./errors";
export const cookieName = "daybook_session";
export const localEnabled = () =>
  process.env.LOCAL_DEMO_ENABLED === "true" &&
  process.env.NODE_ENV !== "production";
export function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new DomainError("AUTH_NOT_CONFIGURED", 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function makeLocalSession(): string {
  requireThat(localEnabled(), "LOCAL_DEMO_DISABLED", 403);
  const secret = process.env.LOCAL_SESSION_SECRET;
  requireThat(secret && secret.length >= 32, "LOCAL_SECRET_REQUIRED", 503);
  const payload = Buffer.from(
    JSON.stringify({
      sub: randomUUID(),
      exp: Date.now() + 12 * 60 * 60 * 1000,
    }),
  ).toString("base64url");
  return `local.${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function cookieValue(req: Request): string | undefined {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
export async function owner(req: Request): Promise<string> {
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ")
    ? bearer.slice(7)
    : cookieValue(req);
  requireThat(token, "AUTH_REQUIRED", 401);
  if (token.startsWith("local.")) {
    requireThat(localEnabled(), "AUTH_REQUIRED", 401);
    const secret = process.env.LOCAL_SESSION_SECRET;
    requireThat(secret, "AUTH_REQUIRED", 401);
    const [, body, signature, ...rest] = token.split(".");
    requireThat(body && signature && !rest.length, "AUTH_REQUIRED", 401);
    const expected = createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(signature, "base64url");
    requireThat(
      given.length === expected.length && timingSafeEqual(given, expected),
      "AUTH_REQUIRED",
      401,
    );
    try {
      const data = JSON.parse(Buffer.from(body, "base64url").toString());
      requireThat(
        typeof data.sub === "string" &&
          /^[0-9a-f-]{36}$/.test(data.sub) &&
          data.exp > Date.now(),
        "AUTH_REQUIRED",
        401,
      );
      return data.sub;
    } catch {
      throw new DomainError("AUTH_REQUIRED", 401);
    }
  }
  const { data, error } = await supabase().auth.getUser(token);
  requireThat(!error && data.user, "AUTH_REQUIRED", 401);
  return data.user.id;
}
export function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin"),
    expected = process.env.APP_ORIGIN;
  // All cookie-authenticated mutations require exact configured origin, even on local hosts.
  requireThat(
    expected && origin === new URL(expected).origin,
    "INVALID_ORIGIN",
    403,
  );
  requireThat(
    req.headers.get("sec-fetch-site") !== "cross-site",
    "CROSS_SITE_REQUEST",
    403,
  );
}
