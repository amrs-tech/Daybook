import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
import { rpc } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({
          sourceText: z.string().trim().min(1).max(8000),
          sourceMode: z.enum(["text", "voice"]),
          requestId: z.string().uuid(),
          confirmed: z.literal(true),
          previousSourceId: z.string().uuid().nullable().optional(),
          transcriptionId: z.string().uuid().nullable().optional(),
        })
        .strict(),
    );
    const ctx = await workspace(id);
    await rpc(id, "reserve_usage", [ctx.id, "request", 1, 0, 0]);
    return ok(
      await rpc(id, "capture_source", [
        ctx.id,
        data.requestId,
        data.sourceText,
        data.sourceMode,
        data.previousSourceId ?? null,
        data.transcriptionId ?? null,
      ]),
    );
  } catch (e) {
    return failure(e);
  }
}
