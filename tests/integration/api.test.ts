import { beforeAll, afterAll, it, expect, describe } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { setup } from "./setup";
import { makeLocalSession } from "../../lib/auth";
import {
  sampleThree,
  sampleSingle,
  sampleSharedRepayment,
  sampleDuplicate,
  sampleAmbiguous,
  sampleSafety,
} from "../../lib/agent/replay";
import { GET as sessionGET } from "../../app/api/session/route";
import { POST as utterancePOST } from "../../app/api/utterances/route";
import { POST as planPOST } from "../../app/api/agent/plan/route";
import {
  PATCH as draftPATCH,
  GET as draftGET,
} from "../../app/api/drafts/[id]/route";
import { POST as previewPOST } from "../../app/api/drafts/[id]/preview/route";
import { POST as commitPOST } from "../../app/api/drafts/[id]/commit/route";
import { GET as ledgerGET } from "../../app/api/ledger/route";
import { GET as exportGET } from "../../app/api/export/route";
import type { Draft } from "../../lib/workflow";
import { setProcessor } from "../../lib/observability/langfuse";
let db: PGlite;
const origin = "http://localhost:3000";
function req(
  path: string,
  token: string,
  body?: unknown,
  customOrigin = origin,
) {
  return new Request(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      origin: customOrigin,
      cookie: `daybook_session=${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
beforeAll(async () => {
  db = await setup();
  process.env.LOCAL_SESSION_SECRET =
    "synthetic-local-test-secret-with-enough-characters";
  process.env.APP_ORIGIN = origin;
});
afterAll(async () => {
  await db.close();
});
async function plan(text: string, token: string) {
  const sourceResponse = await utterancePOST(
    req("/api/utterances", token, {
      sourceText: text,
      sourceMode: "text",
      confirmed: true,
      requestId: randomUUID(),
    }),
  );
  expect(sourceResponse.status).toBe(200);
  const s = (await sourceResponse.json()).data;
  const response = await planPOST(
    req("/api/agent/plan", token, {
      sourceId: s.id,
      sourceVersion: s.version,
      requestId: randomUUID(),
    }),
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body.error)).toBe(200);
  return body.data.draft as Draft;
}
async function editAndPreview(d: Draft, token: string) {
  const updated = await draftPATCH(
    req(`/api/drafts/${d.id}`, token, {
      expectedVersion: d.version,
      writer: d.writer,
    }),
    { params: Promise.resolve({ id: d.id }) },
  );
  const body = await updated.json();
  expect(updated.status, JSON.stringify(body.error)).toBe(200);
  const saved = body.data as Draft;
  const response = await previewPOST(
    req(`/api/drafts/${d.id}/preview`, token, {
      expectedVersion: saved.version,
      acknowledgeDuplicates: true,
    }),
    { params: Promise.resolve({ id: d.id }) },
  );
  expect(response.status).toBe(200);
  return (await response.json()).data as Draft;
}
async function post(d: Draft, token: string) {
  return commitPOST(
    req(`/api/drafts/${d.id}/commit`, token, {
      version: d.version,
      planHash: d.preview!.planHash,
      revision: d.preview!.revision,
      idempotencyKey: d.commit_key,
      approved: true,
    }),
    { params: Promise.resolve({ id: d.id }) },
  );
}
describe("HTTP handler journeys using persisted synthetic records (provider replay)", () => {
  it("A01 typed single expense requires explicit approval and has exact fields", async () => {
    const token = makeLocalSession();
    const d = await plan(sampleSingle, token);
    expect(d.status).toBe("VALIDATED_PREVIEW");
    expect(d.writer.drafts).toHaveLength(1);
    expect(d.actions[0]).toMatchObject({ kind: "expense", amount: "85000" });
    const response = await post(d, token);
    expect(response.status).toBe(200);
    expect((await response.json()).data.receipt.entry_ids).toHaveLength(1);
  });
  it("Scenario A: three actions remain pending until account/date edits and approval", async () => {
    const token = makeLocalSession();
    const before = (await (await ledgerGET(req("/api/ledger", token))).json())
      .data;
    let d = await plan(sampleThree, token);
    expect(d.writer.drafts.length).toBe(3);
    expect(d.status).toBe("NEEDS_CLARIFICATION");
    expect((await post(d, token)).status).toBe(409);
    for (const r of d.writer.drafts) {
      Object.assign(r.fields, {
        bookedOnText: "today",
        accountAlias: r.stepRef === "s3" ? "Cash wallet" : "Everyday bank",
      });
      r.unresolvedFields = [];
    }
    d = await editAndPreview(d, token);
    expect(d.status).toBe("VALIDATED_PREVIEW");
    setProcessor({
      forceFlush: async () => {
        throw new Error("Synthetic exporter outage");
      },
    });
    const response = await post(d, token);
    setProcessor(undefined);
    const result = await response.json();
    expect(response.status, JSON.stringify(result.error)).toBe(200);
    expect(result.data.verified).toBe(true);
    expect(result.data.receipt.entry_ids).toHaveLength(3);
    const after = (await (await ledgerGET(req("/api/ledger", token))).json())
      .data;
    expect(after.entries.length - before.entries.length).toBe(3);
    const repeat = await post(d, token);
    expect((await repeat.json()).data.receipt.id).toBe(result.data.receipt.id);
  });
  it("Scenario B: dinner + partial repayment link to an explicitly selected new claim", async () => {
    const token = makeLocalSession();
    let d = await plan(sampleSharedRepayment, token);
    expect(d.writer.drafts.map((r) => r.kind)).toEqual([
      "shared_payment",
      "settle_claim",
    ]);
    Object.assign(d.writer.drafts[0].fields, {
      personalShareText: "800",
      accountAlias: "Everyday bank",
    });
    d.writer.drafts[0].unresolvedFields = [];
    Object.assign(d.writer.drafts[1].fields, {
      bookedOnText: "yesterday",
      accountAlias: "Everyday bank",
      targetHint: "new:s1:Priya",
    });
    d.writer.drafts[1].unresolvedFields = [];
    d = await editAndPreview(d, token);
    expect(d.preview?.issues).toEqual([]);
    expect(d.actions.map((a) => a.kind)).toEqual([
      "shared_payment",
      "settle_claim",
    ]);
    const response = await post(d, token),
      result = await response.json();
    expect(response.status, JSON.stringify(result.error)).toBe(200);
    const newClaims = result.data.context.claims.filter(
      (c: { entryId: string }) =>
        result.data.receipt.entry_ids.includes(c.entryId),
    );
    expect(
      newClaims.map((c: { outstanding: string }) => c.outstanding).sort(),
    ).toEqual(["30000", "80000"]);
    expect(
      result.data.context.entries
        .filter((e: { id: string; kind: string }) =>
          result.data.receipt.entry_ids.includes(e.id),
        )
        .map((e: { kind: string }) => e.kind)
        .sort(),
    ).toEqual(["settle_claim", "shared_payment"]);
  });
  it("Scenario C: candidate duplicates are shown, no automatic reversal", async () => {
    const token = makeLocalSession();
    const d = await plan(sampleDuplicate, token);
    expect(d.status).toBe("NEEDS_CLARIFICATION");
    expect(d.writer.drafts[0].kind).toBe("undo");
    expect((await post(d, token)).status).toBe(409);
  });
  it("Scenario D: ambiguous payment cannot be posted by filling unrelated fields", async () => {
    const token = makeLocalSession();
    const d = await plan(sampleAmbiguous, token);
    expect(d.planner.steps.length).toBe(0);
    expect(d.planner.globalQuestions.length).toBe(1);
    expect(d.status).toBe("NEEDS_CLARIFICATION");
    expect((await post(d, token)).status).toBe(409);
  });
  it("Scenario E: direct-insert request creates no financial record", async () => {
    const token = makeLocalSession();
    const d = await plan(sampleSafety, token);
    expect(d.actions).toEqual([]);
    expect(d.status).toBe("NEEDS_CLARIFICATION");
    expect((await post(d, token)).status).toBe(409);
  });
  it("A22 guessed draft ID is inaccessible to a different signed session", async () => {
    const token = makeLocalSession(),
      other = makeLocalSession();
    const d = await plan(sampleThree, token);
    const response = await draftGET(req(`/api/drafts/${d.id}`, other), {
      params: Promise.resolve({ id: d.id }),
    });
    expect(response.status).toBe(404);
  });
  it("cookie mutations reject foreign Origin and unauthenticated requests", async () => {
    const token = makeLocalSession();
    expect(
      (
        await utterancePOST(
          req(
            "/api/utterances",
            token,
            { sourceText: "test" },
            "https://evil.invalid",
          ),
        )
      ).status,
    ).toBe(403);
    expect((await ledgerGET(new Request(`${origin}/api/ledger`))).status).toBe(
      401,
    );
  });
  it("exports contain ledger facts but no identity, session, model or transcripts", async () => {
    const token = makeLocalSession();
    await sessionGET(req("/api/session", token));
    const response = await exportGET(req("/api/export?format=json", token));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.currency).toBe("INR");
    expect(Object.keys(data)).not.toContain("ownerId");
    expect(JSON.stringify(data)).not.toContain(token);
  });
});
