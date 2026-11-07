import { parseINR } from "../money";
export function fieldHasEvidence(
  field: string,
  value: string,
  evidence: string | null,
): boolean {
  if (!evidence) return false;
  if (["amountText", "personalShareText"].includes(field)) {
    try {
      return parseINR(value, true) === parseINR(evidence, true);
    } catch {}
    if (!/^[0-9,.]+$/.test(value.trim()))
      return evidence.trim().toLowerCase() === value.trim().toLowerCase();
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?<![0-9.,])" + escaped + "(?![0-9]|[.,][0-9])").test(
      evidence,
    );
  }
  return evidence.toLowerCase().includes(value.toLowerCase());
}

export function shareEvidenceQuote(
  source: string,
  shares: { contactAlias: string; amountText: string }[],
): string | null {
  // Check each person/amount association even when the supplied quote
  // contains every name and number. A broad quote cannot prove allocation.
  const escape = (s: string) => s.replace(/[.*+?^$()|{}[\]\\]/g, "\\$&");
  const names = shares.map((share) => escape(share.contactAlias)).join("|");
  const clauses = source
    .split(
      new RegExp(
        ";|,(?![0-9])|(?<=[.!?])\\s+|\\band\\b(?=\\s+(?:" + names + ")\\b)",
        "i",
      ),
    )
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = shares.map((share) =>
    clauses.find((clause) => {
      const association = new RegExp(
        "(?:^|[^\\p{L}\\p{N}_])" +
          escape(share.contactAlias) +
          "(?:['’]s)?\\s*(?:(?:owes?(?:\\s+me)?|shares?(?:\\s+(?:is|was|of))?|(?:split|portion|allocation)(?:\\s+(?:is|was|of))?)\\s*|:\\s*)(.+)$",
        "iu",
      ).exec(clause);
      if (!association) return false;
      try {
        return (
          parseINR(association[1].replace(/[.!?]$/, ""), true) ===
          parseINR(share.amountText, true)
        );
      } catch {
        return false;
      }
    }),
  );

  if (shares.length === 0 || !selected.every(Boolean)) return null;
  return source.slice(
    Math.min(...selected.map((s) => source.indexOf(s!))),
    Math.max(...selected.map((s) => source.indexOf(s!) + s!.length)),
  );
}
