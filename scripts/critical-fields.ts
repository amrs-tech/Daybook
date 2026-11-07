import { parseINR } from "../lib/money";
import { parseBookedOn } from "../lib/dates";
export function equivalentCriticalField(
  field: string,
  actual: unknown,
  expected: unknown,
  reference: string,
  timezone: string,
): boolean {
  if (actual === expected) return true;
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (["amountText", "personalShareText"].includes(field))
    try {
      return parseINR(actual, true) === parseINR(expected, true);
    } catch {
      return false;
    }
  if (["bookedOnText", "dueOnText"].includes(field))
    try {
      return (
        parseBookedOn(
          actual,
          reference,
          timezone,
          "2000-01-01",
          field === "dueOnText",
        ) ===
        parseBookedOn(
          expected,
          reference,
          timezone,
          "2000-01-01",
          field === "dueOnText",
        )
      );
    } catch {
      return false;
    }
  if (
    [
      "accountAlias",
      "destinationAlias",
      "counterpartyAlias",
      "paymentMethod",
    ].includes(field)
  )
    return actual.toLowerCase() === expected.toLowerCase();
  return false;
}
