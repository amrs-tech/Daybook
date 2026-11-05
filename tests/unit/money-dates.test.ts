import { describe, it, expect } from "vitest";
import { parseINR, formatINR } from "../../lib/money";
import { parseBookedOn, localDate } from "../../lib/dates";
import { csvCell } from "../../lib/export";
describe("T33 exact INR parsing", () => {
  it.each([
    ["0.01", 1n],
    ["250 rupees", 25000n],
    ["₹1,200.50", 120050n],
    ["1,23,456.78", 12345678n],
    ["one thousand two hundred", 120000n],
    ["two lakh fifty thousand", 25000000n],
    ["twenty-five", 2500n],
    ["fifteen", 1500n],
    ["fifty", 5000n],
    ["10000000000", 1000000000000n],
  ])("parses %s", (s, n) => expect(parseINR(s)).toBe(n));
  it.each([
    "0",
    "-1",
    "1.001",
    "NaN",
    "Infinity",
    "1e3",
    "1,20",
    "12,34.00",
    "2.00.1",
    "one point five",
    "fifteen or fifty",
    "half of 500",
    "one thousand thousand",
    "1 200",
    "10000000000.01",
  ])("rejects ambiguous/invalid %s", (s) =>
    expect(() => parseINR(s)).toThrow(),
  );
  it("permits zero only for explicit observation/personal share", () => {
    expect(parseINR("0", true)).toBe(0n);
    expect(() => parseINR("0")).toThrow();
  });
  it("formats without float coercion", () =>
    expect(formatINR("123456789012")).toBe("₹1,23,45,67,890.12"));
});
describe("T18/T19 fixed reference dates", () => {
  it("uses Kolkata date across UTC midnight", () =>
    expect(localDate("2026-11-05T19:00:00Z")).toBe("2026-11-06"));
  it("yesterday remains tied to submission, regardless of approval time", () =>
    expect(parseBookedOn("yesterday", "2026-11-05T19:00:00Z")).toBe(
      "2026-11-05",
    ));
  it.each(["tomorrow", "2026-02-30", "next Friday", "2026-11-07"])(
    "rejects unsupported/future %s",
    (s) => expect(() => parseBookedOn(s, "2026-11-05T19:00:00Z")).toThrow(),
  );
  it("rejects pre-opening", () =>
    expect(() =>
      parseBookedOn(
        "2026-10-01",
        "2026-11-05T00:00:00Z",
        "Asia/Kolkata",
        "2026-10-02",
      ),
    ).toThrow());
});
describe("T30 CSV formula protection", () => {
  it.each(["=SUM(A1)", "+CMD()", "-1+2", "@formula", "\t=1", "  =SUM(A1)"])(
    "escapes %s",
    (v) => expect(csvCell(v)).toMatch(/^"'/),
  );
  it("quotes embedded quotes", () => expect(csvCell('a"b')).toBe('"a""b"'));
});
