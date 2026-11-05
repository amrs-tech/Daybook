import type { Context } from "./ledger/types";
export function csvCell(raw: string): string {
  const value =
    /^[=+\-@]/.test(raw.trimStart()) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${value.replaceAll('"', '""')}"`;
}
export function exportCSV(context: Context): string {
  const rows = [
    ["id", "booked_on", "kind", "description", "amount_paise", "reversed"],
    ...context.entries.map((e) => [
      e.id,
      e.bookedOn,
      e.kind,
      e.description,
      e.amount,
      e.reversed ? "true" : "false",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
