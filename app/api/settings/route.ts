import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
import { rpc } from "@/lib/db";
export const runtime = "nodejs";
export async function PATCH(req: Request) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({
          revision: z.number().int().nonnegative(),
          defaults: z.record(
            z.enum(["UPI", "Cash", "Online", "Other"]),
            z.string().uuid(),
          ),
        })
        .strict(),
    );
    const ctx = await workspace(id);
    await rpc(id, "set_defaults", [
      ctx.id,
      data.revision,
      JSON.stringify(data.defaults),
    ]);
    return ok({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
