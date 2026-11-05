import { owner } from "@/lib/auth";
import { ok, failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    return ok(await workspace(await owner(req)));
  } catch (e) {
    return failure(e);
  }
}
