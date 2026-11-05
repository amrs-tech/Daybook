import { owner } from "@/lib/auth";
import { failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
import { exportCSV } from "@/lib/export";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const ctx = await workspace(await owner(req));
    const csv = new URL(req.url).searchParams.get("format") === "csv";
    // Financial facts only; no provider state, tokens, source transcript, owner ID or model prompts.
    const safe = {
      currency: "INR",
      moneyUnit: "paise",
      timezone: ctx.timezone,
      revision: ctx.revision,
      entries: ctx.entries,
      claims: ctx.claims,
      bills: ctx.bills,
    };
    return new Response(csv ? exportCSV(ctx) : JSON.stringify(safe, null, 2), {
      headers: {
        "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json",
        "Content-Disposition": `attachment; filename="daybook-ledger.${csv ? "csv" : "json"}"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
