import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { rpc } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({ workspaceId: z.string().uuid(), confirmed: z.literal(true) })
        .strict(),
    );
    return ok({
      workspaceId: await rpc(id, "reset_demo", [
        data.workspaceId,
        data.confirmed,
      ]),
    });
  } catch (e) {
    return failure(e);
  }
}
