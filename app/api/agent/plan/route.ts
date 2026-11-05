import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { interpret } from "@/lib/workflow";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({
          sourceId: z.string().uuid(),
          sourceVersion: z.number().int().positive(),
          requestId: z.string().uuid(),
        })
        .strict(),
    );
    return ok(
      await interpret(id, data.sourceId, data.sourceVersion, data.requestId),
    );
  } catch (e) {
    return failure(e);
  }
}
