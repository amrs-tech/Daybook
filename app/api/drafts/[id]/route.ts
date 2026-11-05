import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { row, editDraft } from "@/lib/workflow";
import { WriterSchema } from "@/lib/agent/contracts";
export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Params) {
  try {
    return ok(await row(await owner(req), "drafts", (await params).id));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, { params }: Params) {
  try {
    checkOrigin(req);
    const id = await owner(req);
    const data = await json(
      req,
      z
        .object({
          expectedVersion: z.number().int().positive(),
          writer: WriterSchema,
          reject: z.boolean().optional(),
        })
        .strict(),
    );
    return ok(
      await editDraft(
        id,
        (await params).id,
        data.expectedVersion,
        data.writer,
        data.reject,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
