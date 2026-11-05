import type { Context } from "../ledger/types";
import type { PlannerOutput } from "./contracts";
import { requireThat } from "../errors";
export type Lookups = { tool: string; results: unknown[] }[];
/** No model-supplied SQL, URL, workspace, IDs or executable functions. One bounded read round. */
export function authorizeLookups(
  plan: PlannerOutput,
  context: Context,
): Lookups {
  const selected = [...new Set(plan.steps.flatMap((s) => s.requiresLookup))];
  requireThat(selected.length <= 6, "TOOL_BUDGET_EXCEEDED");
  return selected.map((tool) => {
    let results: unknown[];
    switch (tool) {
      case "accounts":
        results = context.accounts.filter((a) =>
          ["bank", "cash"].includes(a.kind),
        );
        break;
      case "contacts":
        results = context.contacts;
        break;
      case "claims":
        results = context.claims.filter((c) => BigInt(c.outstanding) > 0n);
        break;
      case "bills":
        results = context.bills;
        break;
      case "balances":
        results = context.accounts.map((a) => ({
          label: a.label,
          paise: context.balances[a.id] ?? "0",
        }));
        break;
      case "candidate_transactions":
        results = context.entries
          .filter((e) => !["opening", "reversal"].includes(e.kind))
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amount: e.amount,
            bookedOn: e.bookedOn,
            description: e.description.slice(0, 120),
            reversed: e.reversed,
          }));
        break;
    }
    return { tool, results: results.slice(0, 20) };
  });
}
