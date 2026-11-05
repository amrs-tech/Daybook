import { DomainError } from "./errors";
export function localDate(instant: string, timezone = "Asia/Kolkata"): string {
  const d = new Date(instant);
  if (!Number.isFinite(d.getTime()))
    throw new DomainError("INVALID_REFERENCE_TIME");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function parseBookedOn(
  text: string,
  reference: string,
  timezone = "Asia/Kolkata",
  opening = "2000-01-01",
  allowFuture = false,
): string {
  const today = localDate(reference, timezone);
  let result = text.toLowerCase().trim();
  if (result === "today") result = today;
  else if (result === "yesterday")
    result = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result
  )
    throw new DomainError("DATE_NEEDS_CLARIFICATION");
  if (result < opening) throw new DomainError("DATE_BEFORE_OPENING");
  if (!allowFuture && result > today)
    throw new DomainError("FUTURE_COMPLETED_EVENT");
  return result;
}
