import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { previewDraft } from "@/lib/workflow";
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
          expectedVersion: z.number().int().positive(),
          acknowledgeDuplicates: z.boolean().default(false),
        })
        .strict(),
    );
    return ok(
      await previewDraft(
        id,
        (await params).id,
        data.expectedVersion,
        data.acknowledgeDuplicates,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
