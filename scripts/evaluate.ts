import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  FIXTURE_VERSION,
  evaluationCases,
  voiceScripts,
} from "../fixtures/evaluation";
import { ReplayProvider, replayFixtures } from "../lib/agent/replay";
import { GeminiProvider } from "../lib/agent/providers";
import { runAgents } from "../lib/agent/graph";
import type { Context } from "../lib/ledger/types";
const live = process.argv.includes("--live");
if (live) {
  await import("./evaluate-detailed");
} else {
  const provider = new ReplayProvider();
  const context: Context = {
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
  const configured = !!(
    process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL_ID
  );
  const outcomes = [];
  for (const c of evaluationCases) {
    if (live && !configured) {
      outcomes.push({
        id: c.id,
        status: "blocked",
        reason: "GEMINI_NOT_CONFIGURED",
      });
      continue;
    }
    if (!live && !replayFixtures.some((f) => f.text === c.text)) {
      outcomes.push({
        id: c.id,
        status: "not_run",
        reason: "No fixture replay; reserved for actual model evaluation",
      });
      continue;
    }
    const started = performance.now();
    try {
      const r = await runAgents(
        {
          confirmedText: c.text,
          sourceVersion: 1,
          referenceInstant: "2026-11-05T16:00:00Z",
          context,
          traceId: randomUUID(),
        },
        provider,
      );
      const predicted = r.planner.steps.map((s) => s.kind),
        clarifies =
          r.planner.intent === "clarify" ||
          r.planner.globalQuestions.length > 0 ||
          r.writer.rejectedSteps.length > 0 ||
          r.writer.drafts.some((d) => d.unresolvedFields.length > 0);
      const criticalExact = c.criticalFields
        ? c.criticalFields.every((f, i) =>
            Object.entries(f).every(
              ([k, v]) =>
                (r.writer.drafts[i]?.fields as Record<string, unknown>)?.[k] ===
                v,
            ),
          )
        : null;
      outcomes.push({
        id: c.id,
        status: "measured",
        expectedKinds: c.expectedKinds,
        predictedKinds: predicted,
        operationSequenceExact:
          JSON.stringify(c.expectedKinds) === JSON.stringify(predicted),
        mustClarify: c.mustClarify,
        clarificationDetected: !!clarifies,
        criticalFieldsExact: criticalExact,
        latencyMs: Math.round(performance.now() - started),
        modelCalls: r.modelCalls,
      });
    } catch (e) {
      outcomes.push({
        id: c.id,
        status: "failed",
        error: e instanceof Error ? e.message : "error",
        latencyMs: Math.round(performance.now() - started),
      });
    }
  }
  const measured = outcomes.filter((x) => x.status === "measured"),
    latencies = measured.map((x) => x.latencyMs!).sort((a, b) => a - b),
    critical = measured.filter((x) => x.criticalFieldsExact !== null),
    clarification = measured.filter((x) => x.mustClarify);
  const report = {
    fixtureVersion: FIXTURE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: live ? "actual_gemini" : "deterministic_fixture_replay",
    modelId: provider.modelId || null,
    promptVersions: ["daybook-planner-v2.1", "daybook-writer-v2.1"],
    datasetSize: evaluationCases.length,
    holdoutSize: evaluationCases.filter((x) => x.split === "holdout").length,
    mockedVoiceScripts: voiceScripts.length,
    note: live
      ? "Actual model metrics; inspect raw outcomes and denominators."
      : "Mock measurements verify fixture plumbing only. They do not measure LLM reasoning or STT accuracy.",
    counts: {
      measured: measured.length,
      failed: outcomes.filter((x) => x.status === "failed").length,
      blocked: outcomes.filter((x) => x.status === "blocked").length,
      notRun: outcomes.filter((x) => x.status === "not_run").length,
    },
    metrics: {
      operationSequenceExact: {
        correct: measured.filter((x) => x.operationSequenceExact).length,
        denominator: measured.length,
      },
      criticalFieldsExact: {
        correct: critical.filter((x) => x.criticalFieldsExact).length,
        denominator: critical.length,
      },
      clarificationRecall: {
        correct: clarification.filter((x) => x.clarificationDetected).length,
        denominator: clarification.length,
      },
      p50LatencyMs: latencies.length
        ? latencies[Math.floor((latencies.length - 1) * 0.5)]
        : null,
      p95LatencyMs: latencies.length
        ? latencies[Math.ceil((latencies.length - 1) * 0.95)]
        : null,
      sttAccuracy: null,
      unsupportedAssumptionRate: null,
      ledgerCorrectness:
        "See separately executed SQL/API integration tests; no financial mutation in this eval script",
    },
    outcomes,
  };
  await mkdir("docs/evidence", { recursive: true });
  const path = `docs/evidence/evaluation-${live ? "live" : "replay"}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      path,
      ...report.counts,
      dataset: report.datasetSize,
      mode: report.mode,
    }),
  );
  if (report.counts.failed) process.exitCode = 1;
}
