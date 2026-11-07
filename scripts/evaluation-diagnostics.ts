import type { ModelRequest, ModelProvider } from "../lib/agent/providers";
import { GeminiProvider } from "../lib/agent/providers";

export function makeScrubber(secrets: string[]) {
  const values = [...new Set(secrets.filter((s) => s.length >= 8))].sort(
    (a, b) => b.length - a.length,
  );
  return function scrub<T>(value: T): T {
    const encoded = JSON.stringify(value, (_key, item) => {
      if (typeof item !== "string") return item;
      for (const secret of values) item = item.split(secret).join("[REDACTED]");
      return item
        .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/projects\/\d+/g, "projects/[REDACTED]")
        .replace(/C:[\\/]+Users[\\/]+[^\\/]+/gi, "[USERPROFILE]");
    });
    return encoded === undefined ? value : JSON.parse(encoded);
  };
}

export function httpFailure(status: number, headers: Headers, body: any) {
  const error = body?.error ?? {};
  const details: any[] = Array.isArray(error.details) ? error.details : [];
  const retryInfo = details.find((d) =>
    String(d["@type"]).endsWith("RetryInfo"),
  );
  const quotas = details
    .filter((d) => String(d["@type"]).endsWith("QuotaFailure"))
    .flatMap((d) => d.violations ?? [])
    .map((v) => ({
      quotaMetric: v.quotaMetric,
      quotaId: v.quotaId,
      quotaValue: v.quotaValue,
      model: v.quotaDimensions?.model,
      location: v.quotaDimensions?.location,
    }));
  const retryAfter = headers.get("retry-after");
  const seconds = (s: unknown) =>
    typeof s === "string" && /^\d+(\.\d+)?s?$/.test(s) ? parseFloat(s) : 0;
  const headerWait =
    retryAfter && !/^\d+(\.\d+)?$/.test(retryAfter)
      ? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000)
      : seconds(retryAfter);
  return {
    category:
      status === 429
        ? "rate_or_quota_limit"
        : status >= 500
          ? "provider_server_error"
          : status >= 400
            ? "provider_request_error"
            : "success",
    httpStatus: status,
    apiStatus: error.status ?? null,
    message: error.message ?? null,
    retryAfter,
    retryDelay: retryInfo?.retryDelay ?? null,
    retrySeconds: Math.max(
      Number.isFinite(headerWait) ? headerWait : 0,
      seconds(retryInfo?.retryDelay),
    ),
    quotaViolations: quotas,
    dailyQuota:
      status === 429 &&
      quotas.some((q) => /perday|daily/i.test(String(q.quotaId))),
    requestId:
      headers.get("x-request-id") ?? headers.get("x-goog-request-id") ?? null,
  };
}

export type RequestRecord = {
  role: string;
  structuralRepair: boolean;
  startedAt: string;
  durationMs?: number;
  transport: any[];
  output?: any;
  error?: any;
};

export class DiagnosticGeminiProvider implements ModelProvider {
  modelId: string;
  records: RequestRecord[] = [];
  cooldownUntil = 0;
  dailyQuota = false;
  private active?: RequestRecord;
  private base: GeminiProvider;
  constructor(private scrub: ReturnType<typeof makeScrubber>) {
    this.base = new GeminiProvider({
      fetch: async (input, init) => {
        const began = performance.now();
        try {
          const response = await fetch(input, init);
          const body = await response
            .clone()
            .json()
            .catch(() => ({}));
          const observation = httpFailure(
            response.status,
            response.headers,
            body,
          );
          this.active?.transport.push(
            this.scrub({
              ...observation,
              ...responseMetrics(body),
              durationMs: Math.round(performance.now() - began),
            }),
          );
          if (response.status === 429) {
            this.cooldownUntil = Math.max(
              this.cooldownUntil,
              Date.now() + Math.max(observation.retrySeconds, 60) * 1000,
            );
            this.dailyQuota ||= observation.dailyQuota;
          }
          return response;
        } catch (e: any) {
          this.active?.transport.push(
            this.scrub({
              category: /abort|timeout/i.test(e.name)
                ? "client_timeout_or_abort"
                : "network_error",
              httpStatus: null,
              name: e.name,
              code: e.cause?.code ?? e.code ?? null,
              message: e.message,
              durationMs: Math.round(performance.now() - began),
            }),
          );
          throw e;
        }
      },
    });
    this.modelId = this.base.modelId;
  }
  async invoke(request: ModelRequest) {
    const record: RequestRecord = {
      role: request.role,
      structuralRepair: !!request.repair,
      startedAt: new Date().toISOString(),
      transport: [],
    };
    this.records.push(record);
    this.active = record;
    const began = performance.now();
    try {
      const output = await this.base.invoke(request);
      record.output = this.scrub(output);
      return output;
    } catch (e: any) {
      record.error = this.scrub({
        name: e.name,
        code: e.code ?? null,
        message: e.message,
      });
      throw e;
    } finally {
      record.durationMs = Math.round(performance.now() - began);
      this.active = undefined;
    }
  }
}

export function validationDetails(source: string, requests: RequestRecord[]) {
  const planner = requests
    .filter((r) => r.role === "planner" && r.output)
    .at(-1)?.output;
  const writer = requests
    .filter((r) => r.role === "writer" && r.output)
    .at(-1)?.output;
  const problems: any[] = [];
  for (const step of planner?.steps ?? []) {
    if (
      typeof step.sourceExcerpt === "string" &&
      !source.includes(step.sourceExcerpt)
    )
      problems.push({
        path: `planner.${step.stepRef}.sourceExcerpt`,
        value: step.sourceExcerpt,
        reason: "not an exact substring of confirmed source",
      });
    for (const [field, value] of Object.entries(step.fieldHints ?? {}))
      if (typeof value === "string" && value && !source.includes(value))
        problems.push({
          path: `planner.${step.stepRef}.fieldHints.${field}`,
          value,
          reason: "not an exact substring of confirmed source",
        });
  }
  const fieldMap: Record<string, string> = {
    amountText: "amount",
    bookedOnText: "date",
    paymentMethod: "method",
    accountAlias: "account",
    counterpartyAlias: "counterparty",
    destinationAlias: "destination",
    targetHint: "target",
    personalShareText: "personal",
    dueOnText: "due",
  };
  const seen = new Set<string>();
  for (const draft of writer?.drafts ?? []) {
    seen.add(draft.stepRef);
    for (const [field, value] of Object.entries(draft.evidence ?? {}))
      if (typeof value === "string" && value && !source.includes(value))
        problems.push({
          path: `writer.${draft.stepRef}.evidence.${field}`,
          value,
          reason: "not an exact substring of confirmed source",
        });
    for (const [field, evidenceKey] of Object.entries(fieldMap)) {
      const value = draft.fields?.[field];
      const evidence = draft.evidence?.[evidenceKey];
      if (typeof value === "string" && (!evidence || !evidence.includes(value)))
        problems.push({
          path: `writer.${draft.stepRef}.fields.${field}`,
          value,
          evidence: evidence ?? null,
          reason: "field value is absent from its evidence string",
        });
    }
  }
  for (const rejected of writer?.rejectedSteps ?? []) {
    const step = planner?.steps?.find(
      (s: any) => s.stepRef === rejected.stepRef,
    );
    if (!step || step.kind === "query" || seen.has(rejected.stepRef))
      problems.push({
        path: `writer.rejectedSteps.${rejected.stepRef}`,
        value: rejected,
        plannedKind: step?.kind ?? null,
        alreadyHandled: seen.has(rejected.stepRef),
        reason: !step
          ? "no matching planner step"
          : step.kind === "query"
            ? "query step rejected as a write operation"
            : "step handled more than once",
      });
    seen.add(rejected.stepRef);
  }
  return problems;
}

/** Safe response accounting only: never retain content, thought text or headers. */
export function responseMetrics(body: any) {
  const fields = [
    "promptTokenCount",
    "candidatesTokenCount",
    "responseTokenCount",
    "thoughtsTokenCount",
    "cachedContentTokenCount",
    "toolUsePromptTokenCount",
    "totalTokenCount",
  ];
  const raw = body?.usageMetadata;
  const usageMetadata =
    raw && typeof raw === "object"
      ? Object.fromEntries(
          fields
            .filter((key) => Number.isSafeInteger(raw[key]) && raw[key] >= 0)
            .map((key) => [key, raw[key]]),
        )
      : null;
  return {
    usageMetadata,
    modelVersion:
      typeof body?.modelVersion === "string" ? body.modelVersion : null,
    finishReasons: Array.isArray(body?.candidates)
      ? body.candidates.map((candidate: any) =>
          typeof candidate.finishReason === "string"
            ? candidate.finishReason
            : null,
        )
      : [],
  };
}
