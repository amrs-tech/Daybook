import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  validatePlanner,
  validateWriter,
  WriterSchema,
} from "../../lib/agent/contracts";
import {
  replayFixtures,
  ReplayProvider,
  sampleThree,
  sampleSafety,
} from "../../lib/agent/replay";
import { runAgents } from "../../lib/agent/graph";
import type { Context } from "../../lib/ledger/types";
import { makePreview, normalizeDrafts } from "../../lib/ledger/preview";
import { DomainError } from "../../lib/errors";
const context: Context = {
  id: randomUUID(),
  ownerId: randomUUID(),
  revision: 1,
  openedOn: "2026-10-01",
  timezone: "Asia/Kolkata",
  accounts: [
    { id: randomUUID(), label: "Everyday bank", kind: "bank" },
    { id: randomUUID(), label: "Cash wallet", kind: "cash" },
    { id: randomUUID(), label: "Personal expense", kind: "expense" },
    { id: randomUUID(), label: "Earned income", kind: "income" },
    { id: randomUUID(), label: "Receivables", kind: "receivable" },
  ],
  contacts: [
    { id: randomUUID(), label: "Arun" },
    { id: randomUUID(), label: "Priya" },
  ],
  claims: [],
  bills: [],
  entries: [],
  defaults: {},
  balances: {},
  closedDays: [],
};
const input = (text = sampleThree) => ({
  confirmedText: text,
  sourceVersion: 1,
  referenceInstant: "2026-11-05T16:00:00Z",
  context,
  traceId: randomUUID(),
});
describe("A01/A03 separate bounded nodes", () => {
  it("executes Planner and Writer separately, with one read-only round", async () => {
    const result = await runAgents(input(), new ReplayProvider());
    expect(result.modelCalls).toBe(2);
    expect(result.events.map((e) => e.role)).toEqual([
      "planner",
      "lookup",
      "writer",
    ]);
    expect(result.planner.steps).toHaveLength(3);
    expect(result.writer.drafts).toHaveLength(3);
  });
  it("A13 blocks missing accounts/dates", () => {
    const f = replayFixtures[0],
      n = normalizeDrafts(
        f.writer,
        context,
        input().referenceInstant,
        f.planner,
      );
    expect(n.issues.length).toBeGreaterThan(0);
    expect(n.actions).toHaveLength(0);
  });
  it("A15 pure policy bypass has zero actions", async () => {
    const r = await runAgents(input(sampleSafety), new ReplayProvider());
    expect(r.planner.intent).toBe("unsupported");
    expect(r.writer.drafts).toEqual([]);
  });
  it("never pretends to interpret unknown text in replay mode", async () => {
    await expect(
      runAgents(input("unseen input"), new ReplayProvider()),
    ).rejects.toThrow("Live Gemini");
  });
  it("A16 rejects extra Writer steps", () => {
    const f = structuredClone(replayFixtures[0]);
    f.writer.drafts[0].stepRef = "s9";
    expect(() => validateWriter(f.writer, f.planner, f.text)).toThrow(
      "UNAUTHORIZED",
    );
  });
  it("A17 rejects unknown fields", () => {
    const f = structuredClone(replayFixtures[0]);
    Object.assign(f.writer.drafts[0].fields, { sql: "insert into journal" });
    expect(() => WriterSchema.parse(f.writer)).toThrow();
  });
  it("rejects kind changes", () => {
    const f = structuredClone(replayFixtures[0]);
    f.writer.drafts[0].kind = "income";
    expect(() => validateWriter(f.writer, f.planner, f.text)).toThrow(
      "UNAUTHORIZED",
    );
  });
  it("rejects dropped and duplicated economic events", () => {
    const f = structuredClone(replayFixtures[0]);
    f.writer.drafts.pop();
    expect(() => validateWriter(f.writer, f.planner, f.text)).toThrow(
      "DROPPED",
    );
  });
  it("rejects invented exact-looking amount evidence", () => {
    const f = structuredClone(replayFixtures[0]);
    Object.assign(f.writer.drafts[0].fields, { amountText: "999" });
    expect(() => validateWriter(f.writer, f.planner, f.text)).toThrow(
      "MISSING_FIELD_EVIDENCE",
    );
  });
  it("rejects invented Planner excerpts", () => {
    const f = structuredClone(replayFixtures[0]);
    f.planner.steps[0].sourceExcerpt = "nothing here";
    expect(() => validatePlanner(f.planner, f.text)).toThrow("EVIDENCE");
  });
  it("rejects dependency cycles and unknown tools", () => {
    const f = structuredClone(replayFixtures[0]);
    f.planner.steps[0].dependsOn = ["s2"];
    expect(() => validatePlanner(f.planner, f.text)).toThrow("DEPENDENCY");
  });
  it("allows one structural repair and caps total model calls", async () => {
    let calls = 0;
    const fixture = replayFixtures[1];
    const r = await runAgents(input(fixture.text), {
      modelId: "test",
      async invoke(req) {
        calls++;
        if (calls === 1) return { ...fixture.planner, extra: true };
        return req.role === "planner" ? fixture.planner : fixture.writer;
      },
    });
    expect(r.modelCalls).toBe(3);
    expect(calls).toBe(3);
  });
  it("cannot repair semantic hallucination into an approval", async () => {
    let calls = 0;
    const f = structuredClone(replayFixtures[0]);
    f.planner.steps[0].sourceExcerpt = "invented";
    await expect(
      runAgents(input(), {
        modelId: "test",
        async invoke() {
          calls++;
          return f.planner;
        },
      }),
    ).rejects.toThrow("EVIDENCE");
    expect(calls).toBe(1);
  });
  it("A18 second malformed response fails closed", async () => {
    let calls = 0;
    await expect(
      runAgents(input(), {
        modelId: "test",
        async invoke() {
          calls++;
          return {};
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it("T02 transfer has balanced asset sides only", () => {
    const f = replayFixtures[1],
      n = normalizeDrafts(
        f.writer,
        context,
        input().referenceInstant,
        f.planner,
      );
    expect(n.issues).toEqual([]);
    const p = makePreview(n.actions, context, 1, 1);
    expect(p.issues).toEqual([]);
    expect(p.effects[0].lines).toHaveLength(2);
    expect(
      p.effects[0].lines.every((l) =>
        context.accounts
          .find((a) => a.id === l.accountId)
          ?.kind.match(/bank|cash/),
      ),
    ).toBe(true);
  });
  it("preview hash binds version and workspace revision", () => {
    const a = makePreview([], context, 1, 1);
    expect(a.planHash).not.toBe(
      makePreview([], { ...context, revision: 2 }, 1, 1).planHash,
    );
    expect(a.planHash).not.toBe(makePreview([], context, 2, 1).planHash);
  });
  it("T27 eligible fallback preserves source and reports actual per-agent model IDs", async () => {
    const f = replayFixtures[1];
    let primaryCalls = 0,
      fallbackCalls = 0;
    const r = await runAgents(
      input(f.text),
      {
        modelId: "primary",
        async invoke(req) {
          primaryCalls++;
          if (req.role === "planner")
            throw new DomainError("GEMINI_TRANSIENT_FAILURE", 502);
          return f.writer;
        },
      },
      {
        modelId: "eligible-test-fallback",
        async invoke(req) {
          fallbackCalls++;
          expect((req.payload as { confirmedText: string }).confirmedText).toBe(
            f.text,
          );
          return f.planner;
        },
      },
    );
    expect(r.modelCalls).toBe(3);
    expect(primaryCalls).toBe(2);
    expect(fallbackCalls).toBe(1);
    expect(r.plannerModelId).toBe("eligible-test-fallback");
    expect(r.writerModelId).toBe("primary");
  });
  it("refusal and semantic validation failures do not trigger fallback", async () => {
    let calls = 0;
    await expect(
      runAgents(
        input(),
        {
          modelId: "primary",
          async invoke() {
            throw new DomainError("MODEL_REFUSED_OR_EMPTY", 502);
          },
        },
        {
          modelId: "fallback",
          async invoke() {
            calls++;
            return {};
          },
        },
      ),
    ).rejects.toThrow("REFUSED");
    expect(calls).toBe(0);
  });
  it("T28 both providers fail without fabricated drafts", async () => {
    await expect(
      runAgents(
        input(),
        {
          modelId: "primary",
          async invoke() {
            throw new DomainError("GEMINI_TRANSIENT_FAILURE", 502);
          },
        },
        {
          modelId: "fallback",
          async invoke() {
            throw new DomainError("FALLBACK_REQUEST_FAILED", 502);
          },
        },
      ),
    ).rejects.toThrow("FALLBACK_REQUEST_FAILED");
  });
  it.each([
    "Don't record 250 rupees on coffee",
    "If I spent 250 rupees on coffee",
    "I might pay 250 rupees on coffee",
    "I think I paid 250 rupees on coffee",
  ])("A04/A05 plausible output cannot post uncertain source: %s", (text) => {
    const f = structuredClone(replayFixtures[0]);
    f.planner.steps = [
      { ...f.planner.steps[0], sourceExcerpt: "250 rupees on coffee" },
    ];
    expect(() => validatePlanner(f.planner, text)).toThrow(
      "SOURCE_REQUIRES_CLARIFICATION",
    );
  });
  it("T34 a mixed query never becomes a Writer mutation", () => {
    const f = structuredClone(replayFixtures[0]);
    f.text += " What did I spend?";
    f.planner.intent = "mixed";
    const q = {
      ...f.planner.steps[0],
      kind: "query" as const,
      sourceExcerpt: "What did I spend?",
      stepRef: "s4",
    };
    f.planner.steps.push(q);
    expect(
      validateWriter(f.writer, validatePlanner(f.planner, f.text), f.text)
        .drafts,
    ).toHaveLength(3);
  });
});
