import { owner } from "@/lib/auth";
import { ok, failure } from "@/lib/http";
import { row } from "@/lib/workflow";
import { asOwner } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await owner(req),
      id = (await params).id;
    const run = await row<Record<string, unknown>>(user, "agent_runs", id);
    const events = await asOwner(
      user,
      async (db) =>
        (
          await db.query(
            "select ordinal,agent_role,outcome,duration_ms,redacted_summary,recorded_at from public.agent_step_events where run_id=$1 order by ordinal",
            [id],
          )
        ).rows,
    );
    return ok({ ...run, events });
  } catch (e) {
    return failure(e);
  }
}
