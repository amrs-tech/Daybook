import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runAgents } from "../lib/agent/graph";
import { equivalentCriticalField } from "./critical-fields";
const report = JSON.parse(
  await readFile("docs/evidence/evaluation-fixed-2026-11-07.json", "utf8"),
);
const context: any = {
  id: randomUUID(),
  ownerId: randomUUID(),
  revision: 0,
  timezone: "Asia/Kolkata",
  openedOn: "2026-10-01",
  accounts: [
    { id: randomUUID(), label: "Everyday bank", kind: "bank" },
    { id: randomUUID(), label: "Cash wallet", kind: "cash" },
  ],
  contacts: [
    { id: randomUUID(), label: "Arun" },
    { id: randomUUID(), label: "Priya" },
  ],
  claims: [],
  bills: [],
  entries: [],
  balances: {},
  defaults: {},
  closedDays: [],
};
const outcomes: any[] = [];
for (const c of report.outcomes) {
  const queues: any = {
    planner: c.requests
      .filter((r: any) => r.role === "planner" && r.output)
      .map((r: any) => r.output),
    writer: c.requests
      .filter((r: any) => r.role === "writer" && r.output)
      .map((r: any) => r.output),
  };
  try {
    const r = await runAgents(
      {
        confirmedText: c.text,
        sourceVersion: 1,
        referenceInstant: report.referenceInstant,
        context,
        traceId: randomUUID(),
      },
      {
        modelId: "captured-output-regression",
        async invoke(req) {
          const output = queues[req.role].shift();
          if (!output) throw Error("No captured output for " + req.role);
          return structuredClone(output);
        },
      },
    );
    const sequence =
      JSON.stringify(r.planner.steps.map((s) => s.kind)) ===
      JSON.stringify(c.expectedKinds);
    const clarifies =
      r.planner.intent === "clarify" ||
      r.planner.globalQuestions.length > 0 ||
      r.writer.rejectedSteps.length > 0 ||
      r.writer.drafts.some((d) => d.unresolvedFields.length > 0);
    const critical = c.criticalFields
      ? c.criticalFields.every((fields: any, i: number) =>
          Object.entries(fields).every(([key, value]) =>
            equivalentCriticalField(
              key,
              (r.writer.drafts[i]?.fields as any)?.[key],
              value,
              report.referenceInstant,
              context.timezone,
            ),
          ),
        )
      : true;
    outcomes.push({
      id: c.id,
      status:
        sequence && critical && (!c.mustClarify || clarifies)
          ? "passed"
          : "metric_mismatch",
      sequence,
      critical,
      requiredClarification: !c.mustClarify || clarifies,
    });
  } catch (e: any) {
    outcomes.push({ id: c.id, status: "failed", error: e.code ?? e.message });
  }
}
const result = {
  generatedAt: new Date().toISOString(),
  mode: "captured_output_regression_not_live_AI",
  source: "docs/evidence/evaluation-fixed-2026-11-07.json",
  note: "No network requests. Applies final grounding, guards and validation to previously captured synthetic model outputs. This is separate from the live run and does not measure provider reliability.",
  passed: outcomes.filter((o) => o.status === "passed").length,
  failed: outcomes.filter((o) => o.status !== "passed").length,
  outcomes,
};
await writeFile(
  "docs/evidence/captured-regression-final-2026-11-07.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
