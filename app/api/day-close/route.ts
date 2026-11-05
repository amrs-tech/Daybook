import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
import { rpc, asOwner } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const id = await owner(req);
    return ok(
      await asOwner(
        id,
        async (db) =>
          (
            await db.query(
              "select id,booked_on,snapshot,recorded_at from public.day_closes order by recorded_at desc limit 30",
            )
          ).rows,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z.discriminatedUnion("action", [
        z
          .object({
            action: z.literal("close"),
            bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            confirmed: z.literal(true),
          })
          .strict(),
        z
          .object({
            action: z.literal("reopen"),
            bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            reason: z.string().min(3).max(500),
            confirmed: z.literal(true),
          })
          .strict(),
      ]),
    );
    const c = await workspace(id);
    return ok(
      data.action === "close"
        ? await rpc(id, "close_day", [c.id, data.bookedOn, true])
        : await rpc(id, "reopen_day", [c.id, data.bookedOn, data.reason, true]),
    );
  } catch (e) {
    return failure(e);
  }
}
