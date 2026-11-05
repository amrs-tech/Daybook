import { DomainError } from "./errors";
export const MAX_PAISE = 1_000_000_000_000n;
const units: Record<string, bigint> = {
  zero: 0n,
  one: 1n,
  two: 2n,
  three: 3n,
  four: 4n,
  five: 5n,
  six: 6n,
  seven: 7n,
  eight: 8n,
  nine: 9n,
  ten: 10n,
  eleven: 11n,
  twelve: 12n,
  thirteen: 13n,
  fourteen: 14n,
  fifteen: 15n,
  sixteen: 16n,
  seventeen: 17n,
  eighteen: 18n,
  nineteen: 19n,
  twenty: 20n,
  thirty: 30n,
  forty: 40n,
  fifty: 50n,
  sixty: 60n,
  seventy: 70n,
  eighty: 80n,
  ninety: 90n,
};
function smallWords(words: string[]): bigint {
  if (words.length === 1 && words[0] in units) return units[words[0]];
  if (
    words.length === 2 &&
    units[words[0]] >= 20n &&
    units[words[0]] % 10n === 0n &&
    units[words[1]] > 0n &&
    units[words[1]] < 10n
  )
    return units[words[0]] + units[words[1]];
  const h = words.indexOf("hundred");
  if (h === 1 && units[words[0]] > 0n && units[words[0]] < 10n) {
    let tail = words.slice(2);
    if (tail[0] === "and") tail = tail.slice(1);
    return units[words[0]] * 100n + (tail.length ? smallWords(tail) : 0n);
  }
  throw new DomainError("AMBIGUOUS_AMOUNT");
}
/** Tested English grammar only; no numeric coercion, rounding, or float math. */
export function parseINR(raw: string, allowZero = false): bigint {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:₹|inr|rs\.?)[ \t]*/, "")
    .replace(/\s*(?:rupees?|rs\.?)$/, "")
    .trim();
  let n: bigint;
  if (/^[\d,.]+$/.test(s)) {
    if (
      s.includes(",") &&
      !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(s)
    )
      throw new DomainError("AMBIGUOUS_AMOUNT");
    s = s.replaceAll(",", "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(s))
      throw new DomainError("INVALID_MONEY_PRECISION");
    const [r, p = ""] = s.split(".");
    n = BigInt(r) * 100n + BigInt(p.padEnd(2, "0"));
  } else {
    if (!/^[a-z -]+$/.test(s)) throw new DomainError("AMBIGUOUS_AMOUNT");
    const w = s.replaceAll("-", " ").split(/\s+/);
    let sum = 0n;
    let start = 0;
    let last = 1_000_001n;
    for (let i = 0; i < w.length; i++) {
      const scale = (
        { thousand: 1000n, lakh: 100000n } as Record<string, bigint>
      )[w[i]];
      if (scale) {
        if (scale >= last || i === start)
          throw new DomainError("AMBIGUOUS_AMOUNT");
        sum += smallWords(w.slice(start, i)) * scale;
        start = i + 1;
        last = scale;
      }
    }
    n = (sum + (start < w.length ? smallWords(w.slice(start)) : 0n)) * 100n;
  }
  if (n < (allowZero ? 0n : 1n) || n > MAX_PAISE)
    throw new DomainError("AMOUNT_OUT_OF_RANGE");
  return n;
}
export function formatINR(value: string | bigint): string {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}₹${(a / 100n).toLocaleString("en-IN")}.${(a % 100n).toString().padStart(2, "0")}`;
}
export function rupeeText(value: string): string {
  const n = BigInt(value);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}
