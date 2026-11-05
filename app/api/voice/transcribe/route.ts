import { z } from "zod";
import { owner, checkOrigin } from "@/lib/auth";
import { ok, failure, boundedForm } from "@/lib/http";
import { asOwner, rpc } from "@/lib/db";
import { workspace } from "@/lib/workflow";
import { inspectWav, MAX_AUDIO_BYTES } from "@/lib/voice/audio";
import { transcribeWav } from "@/lib/voice/elevenlabs";
import { requireThat } from "@/lib/errors";
import { traced, flushTraces } from "@/lib/observability/langfuse";
import { randomUUID, createHash } from "node:crypto";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  const traceId = randomUUID();
  let lease: { owner: string; workspace: string } | undefined;
  try {
    checkOrigin(req);
    const id = await owner(req);
    requireThat(
      req.headers.get("content-type")?.startsWith("multipart/form-data"),
      "MULTIPART_REQUIRED",
      400,
    );
    requireThat(
      Number(req.headers.get("content-length") ?? 0) <= MAX_AUDIO_BYTES + 65536,
      "AUDIO_SIZE_LIMIT",
      413,
    );
    const ctx = await workspace(id);
    await rpc(id, "reserve_usage", [ctx.id, "request", 1, 0, 0]);
    const data = await boundedForm(req, MAX_AUDIO_BYTES + 65536);
    const audio = data.get("audio"),
      request = z.string().uuid().parse(data.get("clientRequestId"));
    requireThat(audio instanceof File, "AUDIO_FILE_REQUIRED", 400);
    requireThat(audio.size <= MAX_AUDIO_BYTES, "AUDIO_SIZE_LIMIT", 413);
    const bytes = new Uint8Array(await audio.arrayBuffer()),
      info = inspectWav(bytes, audio.type);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = await asOwner(
      id,
      async (db) =>
        (
          await db.query(
            "select id,transcript_text,duration_ms,audio_sha256 from public.voice_transcriptions where workspace_id=$1 and request_id=$2",
            [ctx.id, request],
          )
        ).rows[0],
    );
    if (existing) {
      requireThat(existing.audio_sha256 === hash, "IDEMPOTENCY_CONFLICT", 409);
      return ok(
        {
          text: existing.transcript_text,
          provider: "elevenlabs",
          model: "scribe_v2",
          durationMs: existing.duration_ms,
          transcriptionId: existing.id,
        },
        traceId,
      );
    }
    requireThat(process.env.ELEVENLABS_API_KEY, "VOICE_NOT_CONFIGURED", 503);
    await rpc(id, "reserve_usage", [
      ctx.id,
      "voice",
      1,
      bytes.length,
      info.durationMs,
    ]);
    lease = { owner: id, workspace: ctx.id };
    const result = await traced(
      "daybook.transcription",
      traceId,
      { modelId: "scribe_v2" },
      () => transcribeWav(bytes),
    );
    const stored = await rpc<{ id: string }>(id, "store_transcription", [
      ctx.id,
      request,
      result.text,
      info.durationMs,
      hash,
    ]);
    return ok(
      { ...result, durationMs: info.durationMs, transcriptionId: stored.id },
      traceId,
    );
  } catch (e) {
    return failure(e, traceId);
  } finally {
    if (lease)
      try {
        await rpc(lease.owner, "release_voice", [lease.workspace]);
      } catch {}
    await flushTraces();
  }
}
