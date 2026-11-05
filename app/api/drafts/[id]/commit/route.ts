import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { commitDraft } from "@/lib/workflow";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({
          version: z.number().int().positive(),
          planHash: z.string().regex(/^[a-f0-9]{64}$/),
          revision: z.number().int().nonnegative(),
          idempotencyKey: z.string().uuid(),
          approved: z.literal(true),
        })
        .strict(),
    );
    return ok(
      await commitDraft(
        id,
        (await params).id,
        data.version,
        data.planHash,
        data.revision,
        data.idempotencyKey,
        data.approved,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
