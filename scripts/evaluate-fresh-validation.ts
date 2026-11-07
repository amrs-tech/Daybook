import { evaluationCases } from "../fixtures/evaluation";
const cases: [string, string[], boolean][] = [
  [
    "Please record 185 rupees for breakfast using UPI from Everyday bank today.",
    ["expense"],
    false,
  ],
  ["Today 12000 rupees of salary arrived in Everyday bank.", ["income"], false],
  [
    "Today I moved 375 rupees out of Everyday bank into Cash wallet.",
    ["transfer"],
    false,
  ],
  [
    "Today I covered 960 rupees from Everyday bank for lunch; my part was 240 and Priya owes 720.",
    ["shared_payment"],
    false,
  ],
  ["Today I lent Priya 350 rupees from Cash wallet.", ["lend"], false],
  [
    "Record an unpaid 425 rupees water bill dated today, due 2026-12-12.",
    ["create_bill"],
    false,
  ],
  ["List the income I recorded yesterday.", ["query"], false],
  ["Do not record the 75 rupees tea purchase.", [], false],
  ["Please send Priya 1500 rupees automatically from my real bank.", [], false],
  ["Record the 450 rupees refund as income.", [], true],
  ["Log a payment of 95 rupees I made yesterday.", [], true],
  ["Record 7.123 rupees for tea from Cash wallet today.", ["expense"], true],
];
evaluationCases.splice(
  0,
  evaluationCases.length,
  ...cases.map(([text, expectedKinds, mustClarify], i) => ({
    id: "F" + String(i + 1).padStart(3, "0"),
    text,
    expectedKinds,
    mustClarify,
    split: "holdout" as const,
  })),
);
process.argv.push("--fixture-version", "daybook-fresh-validation-v1");
await import("./evaluate-detailed");
