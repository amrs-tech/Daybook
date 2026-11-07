import { randomUUID } from "node:crypto";
import { asOwner, rpc } from "./db";
import { DomainError, requireThat } from "./errors";
import type { Context, Preview } from "./ledger/types";
import { makePreview, normalizeDrafts, canonical } from "./ledger/preview";
import { runAgents } from "./agent/graph";
import { GeminiProvider } from "./agent/providers";
import { ReplayProvider } from "./agent/replay";
import {
  WriterSchema,
  type WriterOutput,
  type PlannerOutput,
} from "./agent/contracts";
import { localEnabled } from "./auth";
import { traced, flushTraces } from "./observability/langfuse";
export type Source = {
  id: string;
  workspace_id: string;
  version: number;
  confirmed_text: string;
  reference_instant: string;
  source_mode: "text" | "voice";
};
export type Draft = {
  id: string;
  workspace_id: string;
  source_id: string;
  run_id: string;
  source_version: number;
  version: number;
  status: string;
  writer: WriterOutput;
  planner: PlannerOutput;
  preview: Preview | null;
  actions: Preview["actions"];
  commit_key: string;
  human_edits: unknown[];
};
export async function workspace(ownerId: string): Promise<Context> {
  const id = await rpc<string>(ownerId, "initialize_workspace");
  if (process.env.DEMO_MODE_ENABLED !== "false")
    await rpc(ownerId, "seed_demo", [id]);
  return rpc<Context>(ownerId, "context", [id]);
}
export async function row<T>(
  ownerId: string,
  table: "sources" | "drafts" | "agent_runs" | "receipts",
  id: string,
): Promise<T> {
  requireThat(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    "INVALID_IDENTIFIER",
    400,
  );
  return asOwner(ownerId, async (db) => {
    const result = await db.query(`select * from public.${table} where id=$1`, [
      id,
    ]);
    requireThat(result.rows.length === 1, "NOT_FOUND", 404);
    return result.rows[0] as T;
  });
}
export async function interpret(
  ownerId: string,
  sourceId: string,
  version: number,
  requestId: string,
) {
  const source = await row<Source>(ownerId, "sources", sourceId);
  requireThat(source.version === version, "STALE_SOURCE", 409);
  const context = await rpc<Context>(ownerId, "context", [source.workspace_id]);
  const provider =
    process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL_ID
      ? new GeminiProvider()
      : localEnabled()
        ? new ReplayProvider()
        : new GeminiProvider();
  const id = randomUUID(),
    traceId = randomUUID().replaceAll("-", "");
  const run = await rpc<{
    id: string;
    status: string;
    payload: { draftId?: string };
  }>(ownerId, "begin_run", [
    context.id,
    source.id,
    requestId,
    id,
    traceId,
    provider.modelId,
  ]);
  if (run.id !== id) {
    return {
      runId: run.id,
      draft: run.payload.draftId
        ? await row<Draft>(ownerId, "drafts", run.payload.draftId)
        : null,
      status: run.status,
      replayed: true,
    };
  }
  try {
    // Reserve worst-case provider call budget up front; unused reserved calls are deliberately not refunded.
    if (provider instanceof GeminiProvider)
      await rpc(ownerId, "reserve_usage", [context.id, "model", 3, 0, 0]);
    const output = await traced(
      "daybook.agent",
      traceId,
      { modelId: provider.modelId, version: source.version },
      () =>
        runAgents(
          {
            confirmedText: source.confirmed_text,
            sourceVersion: source.version,
            referenceInstant: source.reference_instant,
            context,
            traceId,
          },
          provider,
        ),
    );
    const draftId = randomUUID();
    const draft = await rpc<Draft>(ownerId, "store_draft", [
      context.id,
      draftId,
      source.id,
      id,
      JSON.stringify(output.writer),
      JSON.stringify(output.planner),
    ]);
    const previewed = await previewDraft(
      ownerId,
      draft.id,
      draft.version,
      false,
    );
    await rpc(ownerId, "finish_run", [
      context.id,
      id,
      previewed.status,
      JSON.stringify({
        draftId,
        modelCalls: output.modelCalls,
        modelId: output.modelId,
        plannerModelId: output.plannerModelId,
        writerModelId: output.writerModelId,
        executionRevision: output.executionRevision,
        transientRetries: output.transientRetries,
        planner: output.planner,
        lookups: output.lookups,
      }),
      null,
      JSON.stringify(output.events),
    ]);
    return { runId: id, draft: previewed, status: previewed.status, traceId };
  } catch (e) {
    const error = e instanceof DomainError ? e.code : "AGENT_OUTPUT_INVALID";
    await rpc(ownerId, "finish_run", [
      context.id,
      id,
      "FAILED_RETRYABLE",
      JSON.stringify({
        providerFailure:
          (e as { providerFailure?: unknown }).providerFailure ?? null,
        executionRevision: "daybook-execution-v2.2",
      }),
      error,
      JSON.stringify((e as { events?: unknown }).events ?? []),
    ]);
    if (e instanceof DomainError) throw e;
    throw new DomainError(error, 502);
  } finally {
    await flushTraces();
  }
}
export async function previewDraft(
  ownerId: string,
  id: string,
  version: number,
  acknowledgedDuplicates: boolean,
): Promise<Draft> {
  const draft = await row<Draft>(ownerId, "drafts", id);
  requireThat(draft.version === version, "STALE_DRAFT", 409);
  const source = await row<Source>(ownerId, "sources", draft.source_id);
  const context = await rpc<Context>(ownerId, "context", [draft.workspace_id]);
  const normalized = normalizeDrafts(
    draft.writer,
    context,
    source.reference_instant,
    draft.planner,
    draft.actions,
  );
  const preview = makePreview(
    normalized.actions,
    context,
    draft.version,
    draft.source_version,
    acknowledgedDuplicates,
  );
  preview.issues.push(...normalized.issues);
  // Planner ambiguity is semantic and cannot be erased by filling unrelated form fields.
  if (draft.planner.globalQuestions.length)
    preview.issues.push({
      stepRef: "all",
      field: "source",
      code: "PLANNER_CLARIFICATION",
      message: draft.planner.globalQuestions.join(" "),
    });
  return traced(
    "daybook.preview",
    draft.run_id,
    { version, stepCount: normalized.actions.length },
    () =>
      rpc<Draft>(ownerId, "save_preview", [
        context.id,
        draft.id,
        version,
        context.revision,
        JSON.stringify(preview),
      ]),
  );
}
export async function editDraft(
  ownerId: string,
  id: string,
  version: number,
  raw: unknown,
  reject = false,
) {
  const draft = await row<Draft>(ownerId, "drafts", id);
  const writer = WriterSchema.parse(raw);
  requireThat(
    writer.drafts.length === draft.writer.drafts.length &&
      writer.rejectedSteps.length === draft.writer.rejectedSteps.length,
    "CANNOT_CHANGE_PLANNED_OPERATIONS",
  );
  for (const d of writer.drafts) {
    const original = draft.writer.drafts.find((x) => x.stepRef === d.stepRef);
    requireThat(
      original && original.kind === d.kind,
      "CANNOT_CHANGE_PLANNED_OPERATIONS",
    );
    requireThat(
      canonical(original.evidence) === canonical(d.evidence),
      "SOURCE_EVIDENCE_IMMUTABLE",
    );
  }
  requireThat(
    new Set(writer.drafts.map((d) => d.stepRef)).size === writer.drafts.length,
    "DUPLICATE_WRITER_STEP",
  );
  return rpc<Draft>(ownerId, "edit_draft", [
    draft.workspace_id,
    id,
    version,
    JSON.stringify(writer),
    JSON.stringify([
      {
        at: new Date().toISOString(),
        previousVersion: version,
        kind: "explicit_human_form_edit",
        fields: writer.drafts.map((d) => ({
          stepRef: d.stepRef,
          fields: d.fields,
        })),
      },
    ]),
    reject,
  ]);
}
export async function commitDraft(
  ownerId: string,
  id: string,
  version: number,
  hash: string,
  revision: number,
  key: string,
  approved: boolean,
) {
  const draft = await row<Draft>(ownerId, "drafts", id);
  const receipt = await traced(
    "daybook.commit",
    draft.run_id,
    { version, status: "approved" },
    () =>
      rpc<{ id: string; entry_ids: string[]; draft_id: string }>(
        ownerId,
        "commit_batch",
        [draft.workspace_id, id, version, hash, revision, key, approved],
      ),
  );
  // Read-after-write from canonical facts, independent of the returned model narrative.
  const persisted = await row<{ id: string }>(ownerId, "receipts", receipt.id);
  requireThat(persisted.id === receipt.id, "RECEIPT_VERIFICATION_FAILED", 503);
  const context = await rpc<Context>(ownerId, "context", [draft.workspace_id]);
  requireThat(
    receipt.entry_ids.every((id) => context.entries.some((e) => e.id === id)),
    "POST_COMMIT_VERIFICATION_FAILED",
    503,
  );
  await rpc(ownerId, "record_verification", [
    draft.workspace_id,
    draft.run_id,
    receipt.id,
  ]);
  await flushTraces();
  return { receipt, verified: true, context };
}
