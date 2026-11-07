import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { evaluationCases, FIXTURE_VERSION } from "../fixtures/evaluation";
import { equivalentCriticalField } from "./critical-fields";
import { EXECUTION_REVISION } from "../lib/agent/prompts/execution-v2.2";
import { runAgents } from "../lib/agent/graph";
import type { Context } from "../lib/ledger/types";
import {
  DiagnosticGeminiProvider,
  makeScrubber,
  validationDetails,
} from "./evaluation-diagnostics";

const argument = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const intervalMs = Number(argument("--interval-ms", "15000"));
if (!Number.isFinite(intervalMs) || intervalMs < 0)
  throw Error("Invalid interval");
const outputPath = argument(
  "--output",
  "docs/evidence/evaluation-fixed-2026-11-07.json",
);
const limit = Number(argument("--limit", String(evaluationCases.length)));
const requested = argument("--cases", "").split(",").filter(Boolean);
if (requested.some((id) => !evaluationCases.some((c) => c.id === id)))
  throw Error("Unknown evaluation case");
const selectedCases = evaluationCases
  .filter((c) => !requested.length || requested.includes(c.id))
  .slice(0, limit);
const secrets = Object.entries(process.env)
  .filter(([k]) => /KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k))
  .map(([, v]) => v ?? "");
for (const s of [...secrets])
  try {
    const u = new URL(s);
    if (u.password) secrets.push(decodeURIComponent(u.password));
  } catch {}
const scrub = makeScrubber(secrets);
const modelOverride = argument("--model", "");
if (modelOverride) process.env.GEMINI_MODEL_ID = modelOverride;
const provider = new DiagnosticGeminiProvider(scrub);
if (!process.env.GEMINI_API_KEY || !provider.modelId)
  throw Error("Gemini credentials not configured");
if (process.env.OPENAI_FALLBACK_ENABLED === "true")
  throw Error("Disable fallback for a Gemini-only diagnostic comparison");
const sourceFiles = [
  "lib/agent/providers.ts",
  "lib/agent/graph.ts",
  "lib/agent/contracts.ts",
  "lib/agent/evidence.ts",
  "lib/agent/grounding.ts",
  "lib/agent/gemini-schema.ts",
  "lib/agent/prompts/planner-v2.1.ts",
  "lib/agent/prompts/writer-v2.1.ts",
  "lib/agent/prompts/execution-v2.2.ts",
  "lib/agent/tool-registry.ts",
  "lib/money.ts",
  "lib/dates.ts",
  "scripts/evaluate-detailed.ts",
  "scripts/evaluation-diagnostics.ts",
  "scripts/critical-fields.ts",
  "fixtures/evaluation.ts",
  "package-lock.json",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ]),
  ),
);
const startedAt = new Date().toISOString();
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
const referenceInstant = "2026-11-05T16:00:00Z";
const outcomes: any[] = [];
let nextStart = 0;
const base = {
  sourceHashes,
  datasetHash: createHash("sha256")
    .update(JSON.stringify(selectedCases))
    .digest("hex"),
  generationSettings: {
    temperature: 0,
    maxOutputTokens: 8192,
    thinkingConfig: "provider default; no override",
    tools: "none",
    responseMimeType: "application/json",
  },
  fixtureVersion: argument("--fixture-version", FIXTURE_VERSION),
  startedAt,
  modelId: provider.modelId,
  datasetSize: evaluationCases.length,
  selectedSize: selectedCases.length,
  holdoutSize: evaluationCases.filter((c) => c.split === "holdout").length,
  referenceInstant,
  intervalMs,
  parallelism: 1,
  automaticCaseRetries: 0,
  sdkAttemptsPerInvocation: 1,
  perRequestTimeoutMs: 25000,
  agentBudgetMs: 50000,
  executionRevision: EXECUTION_REVISION,
  promptVersions: ["daybook-planner-v2.1", "daybook-writer-v2.1"],
  priorReport: "docs/evidence/evaluation-live-baseline-2026-11-06.json",
  notes: [
    "Uses the actual production GeminiProvider and graph; only the fetch transport is observed.",
    "Pacing is between cases, outside the 50-second agent budget. This run tests execution policy v2.2, 25-second requests, grounding and at most one transient retry within the three-call cap.",
    "Synthetic fixture inputs and model outputs are retained for diagnosis; credentials, authorization headers, cookies and request URLs are not recorded.",
    "No ledger writes; no fallback; no case retries. A transient retry or structural repair shares the same three-invocation cap.",
  ],
};
function summary() {
  const completed = outcomes.filter((o) => o.status === "measured"),
    failed = outcomes.filter((o) => o.status === "failed");
  const http = provider.records.flatMap((r) => r.transport);
  const counts = {
    measured: completed.length,
    failed: failed.length,
    blocked: outcomes.filter((o) => o.status === "blocked").length,
    remaining: selectedCases.length - outcomes.length,
  };
  const errors: Record<string, number> = {};
  for (const o of failed) errors[o.error] = (errors[o.error] ?? 0) + 1;
  const httpStatuses: Record<string, number> = {};
  for (const h of http) {
    const k = h.httpStatus === null ? "no_http_response" : String(h.httpStatus);
    httpStatuses[k] = (httpStatuses[k] ?? 0) + 1;
  }
  const critical = completed.filter((o) => o.criticalFieldsExact !== null),
    clarify = completed.filter((o) => o.mustClarify);
  return {
    counts,
    errors,
    httpStatuses,
    requestCount: provider.records.length,
    httpAttempts: http.length,
    confirmed429Responses: http.filter((h) => h.httpStatus === 429).length,
    serverErrorResponses: http.filter((h) => h.httpStatus >= 500).length,
    networkOrTimeoutErrors: http.filter((h) => h.httpStatus === null).length,
    metrics: {
      operationSequenceExact: {
        correct: completed.filter((o) => o.operationSequenceExact).length,
        denominator: completed.length,
      },
      criticalFieldsSemantic: {
        correct: critical.filter((o) => o.criticalFieldsSemantic).length,
        denominator: critical.length,
      },
      criticalFieldsExact: {
        correct: critical.filter((o) => o.criticalFieldsExact).length,
        denominator: critical.length,
      },
      clarificationRecall: {
        correct: clarify.filter((o) => o.clarificationDetected).length,
        denominator: clarify.length,
      },
    },
    allApplicableMetricsPassed: completed.filter(
      (o) =>
        o.operationSequenceExact &&
        o.criticalFieldsSemantic !== false &&
        (!o.mustClarify || o.clarificationDetected),
    ).length,
  };
}
async function save(complete: boolean) {
  await writeFile(
    outputPath,
    JSON.stringify(
      scrub({
        ...base,
        updatedAt: new Date().toISOString(),
        complete,
        ...summary(),
        outcomes,
      }),
      null,
      2,
    ),
  );
}
await mkdir("docs/evidence", { recursive: true });
try {
  await readFile(base.priorReport);
} catch {
  await writeFile(
    base.priorReport,
    await readFile("docs/evidence/evaluation-live.json"),
  );
}
for (const c of selectedCases) {
  if (provider.dailyQuota) {
    outcomes.push({
      ...c,
      status: "blocked",
      reason: "DAILY_QUOTA_EXHAUSTED_CONFIRMED_IN_PROVIDER_RESPONSE",
    });
    await save(false);
    continue;
  }
  let waitUntil = Math.max(nextStart, provider.cooldownUntil);
  if (waitUntil > Date.now())
    console.log(
      JSON.stringify({
        event: "pacing",
        nextCase: c.id,
        waitSeconds: Math.ceil((waitUntil - Date.now()) / 1000),
      }),
    );
  while (Date.now() < waitUntil)
    await new Promise((r) =>
      setTimeout(r, Math.min(10000, waitUntil - Date.now())),
    );
  const begin = performance.now();
  const before = provider.records.length;
  nextStart = Date.now() + intervalMs;
  const outcome: any = { ...c, startedAt: new Date().toISOString() };
  try {
    const r = await runAgents(
      {
        confirmedText: c.text,
        sourceVersion: 1,
        referenceInstant,
        context,
        traceId: randomUUID(),
      },
      provider,
    );
    const predicted = r.planner.steps.map((s) => s.kind);
    const clarifies =
      r.planner.intent === "clarify" ||
      r.planner.globalQuestions.length > 0 ||
      r.writer.rejectedSteps.length > 0 ||
      r.writer.drafts.some((d) => d.unresolvedFields.length > 0);
    const differences =
      c.criticalFields?.flatMap((fields, i) =>
        Object.entries(fields)
          .filter(
            ([key, expected]) =>
              (r.writer.drafts[i]?.fields as any)?.[key] !== expected,
          )
          .map(([field, expected]) => ({
            draftIndex: i,
            field,
            expected,
            actual: (r.writer.drafts[i]?.fields as any)?.[field] ?? null,
          })),
      ) ?? [];
    Object.assign(outcome, {
      status: "measured",
      predictedKinds: predicted,
      operationSequenceExact:
        JSON.stringify(predicted) === JSON.stringify(c.expectedKinds),
      clarificationDetected: !!clarifies,
      criticalFieldsExact: c.criticalFields ? differences.length === 0 : null,
      criticalFieldsSemantic: c.criticalFields
        ? differences.every((d) =>
            equivalentCriticalField(
              d.field,
              d.actual,
              d.expected,
              referenceInstant,
              context.timezone,
            ),
          )
        : null,
      criticalFieldDifferences: differences,
      validatedPlanner: r.planner,
      validatedWriter: r.writer,
      transientRetries: r.transientRetries,
      events: r.events,
      modelCalls: r.modelCalls,
    });
  } catch (e: any) {
    Object.assign(outcome, {
      status: "failed",
      error: e.code ?? e.name ?? "error",
      message: e.message,
      events: e.events ?? [],
      structuralIssues: e.issues?.map((i: any) => ({
        code: i.code,
        path: i.path,
        message: i.message,
      })),
      stack: e.stack?.split("\n").slice(0, 7),
    });
  }
  outcome.latencyMs = Math.round(performance.now() - begin);
  outcome.requests = provider.records.slice(before);
  outcome.validationDetails = validationDetails(c.text, outcome.requests);
  outcome.outputHashes = outcome.requests
    .filter((r: any) => r.output)
    .map((r: any) => ({
      role: r.role,
      sha256: createHash("sha256")
        .update(JSON.stringify(r.output))
        .digest("hex"),
    }));
  outcomes.push(scrub(outcome));
  await save(false);
  console.log(
    JSON.stringify({
      event: "case",
      id: c.id,
      status: outcome.status,
      error: outcome.error ?? null,
      latencyMs: outcome.latencyMs,
      http: outcome.requests.flatMap((r: any) =>
        r.transport.map((h: any) => h.httpStatus ?? h.category),
      ),
      completed: outcomes.length,
      total: selectedCases.length,
    }),
  );
}
await save(true);
console.log(JSON.stringify({ event: "complete", outputPath, ...summary() }));
if (
  summary().counts.failed ||
  summary().counts.blocked ||
  summary().allApplicableMetricsPassed !== summary().counts.measured
)
  process.exitCode = 1;
