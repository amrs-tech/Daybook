import { describe, it, expect, afterEach, vi } from "vitest";
import {
  httpFailure,
  responseMetrics,
  DiagnosticGeminiProvider,
  makeScrubber,
  validationDetails,
} from "../../scripts/evaluation-diagnostics";
import { GeminiProvider } from "../../lib/agent/providers";
import { z } from "zod";

describe("Live evaluation diagnostics", () => {
  it("distinguishes 429 daily quota from service failures and respects provider retry guidance", () => {
    const result = httpFailure(429, new Headers({ "retry-after": "12" }), {
      error: {
        status: "RESOURCE_EXHAUSTED",
        message: "quota",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "45.5s",
          },
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                quotaValue: "20",
              },
            ],
          },
        ],
      },
    });
    expect(result.dailyQuota).toBe(true);
    expect(result.retrySeconds).toBe(45.5);
    expect(result.category).toBe("rate_or_quota_limit");
    expect(
      httpFailure(503, new Headers(), { error: { status: "UNAVAILABLE" } })
        .category,
    ).toBe("provider_server_error");
  });
  it("redacts secret values, bearer credentials and API-key query parameters without hiding synthetic evidence", () => {
    const scrub = makeScrubber(["private-key-example"]);
    expect(
      scrub({
        value: "private-key-example Bearer abc.def key",
        url: "https://example.test?key=hidden",
        evidence: "250 rupees",
      }),
    ).toEqual({
      value: "[REDACTED] Bearer [REDACTED] key",
      url: "https://example.test?key=[REDACTED]",
      evidence: "250 rupees",
    });
  });
  it("identifies the exact unsupported payment field and invalid query rejection", () => {
    const records: any = [
      {
        role: "planner",
        output: {
          steps: [
            {
              stepRef: "s1",
              kind: "query",
              sourceExcerpt: "show balance",
              fieldHints: {},
            },
          ],
        },
      },
      {
        role: "writer",
        output: {
          drafts: [
            {
              stepRef: "s2",
              fields: { paymentMethod: "UPI" },
              evidence: { method: null },
            },
          ],
          rejectedSteps: [{ stepRef: "s1", reason: "query" }],
        },
      },
    ];
    const details = validationDetails("show balance", records);
    expect(details).toContainEqual(
      expect.objectContaining({
        path: "writer.s2.fields.paymentMethod",
        value: "UPI",
        evidence: null,
      }),
    );
    expect(details).toContainEqual(
      expect.objectContaining({
        path: "writer.rejectedSteps.s1",
        plannedKind: "query",
      }),
    );
  });
  it("observes the real SDK response through injected fetch while retaining production error codes", async () => {
    vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key");
    vi.stubEnv("GEMINI_MODEL_ID", "synthetic-model");
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: "rate limit",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "30",
            },
          },
        ),
    );
    const provider = new GeminiProvider({ fetch: fetcher as typeof fetch });
    await expect(
      provider.invoke({
        role: "planner",
        system: "test",
        payload: {},
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({ code: "GEMINI_TRANSIENT_FAILURE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("records accounting including thinking and cache tokens without retaining response content", async () => {
    vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key");
    vi.stubEnv("GEMINI_MODEL_ID", "synthetic-model");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: '{"ok":true}' }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 200,
                thoughtsTokenCount: 300,
                cachedContentTokenCount: 400,
                totalTokenCount: 1500,
                secret: "do-not-retain",
              },
              modelVersion: "synthetic-model-version",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const provider = new DiagnosticGeminiProvider(
      makeScrubber(["synthetic-test-key"]),
    );
    await expect(
      provider.invoke({
        role: "planner",
        system: "test",
        payload: {},
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ ok: true });
    const transport = provider.records[0].transport[0];
    expect(transport.usageMetadata).toEqual({
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 300,
      cachedContentTokenCount: 400,
      totalTokenCount: 1500,
    });
    expect(transport.finishReasons).toEqual(["STOP"]);
    expect(JSON.stringify(transport)).not.toContain("do-not-retain");
    expect(
      responseMetrics({
        usageMetadata: { promptTokenCount: -1, candidatesTokenCount: "200" },
      }).usageMetadata,
    ).toEqual({});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
