import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "./errors";
export function ok(data: unknown, traceId = randomUUID(), status = 200) {
  return NextResponse.json(
    { data, error: null, traceId },
    { status, headers: { "Cache-Control": "no-store, private" } },
  );
}
export function failure(e: unknown, traceId = randomUUID()) {
  const err =
    e instanceof DomainError
      ? e
      : e instanceof z.ZodError
        ? new DomainError("INVALID_REQUEST", 400)
        : new DomainError("INTERNAL_ERROR", 500);
  return NextResponse.json(
    { data: null, error: { code: err.code, message: err.message }, traceId },
    { status: err.status, headers: { "Cache-Control": "no-store, private" } },
  );
}
export async function json<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new DomainError("JSON_REQUIRED", 400);
  if (Number(req.headers.get("content-length") ?? 0) > 100000)
    throw new DomainError("REQUEST_TOO_LARGE", 413);
  const text = await req.text();
  if (Buffer.byteLength(text) > 100000)
    throw new DomainError("REQUEST_TOO_LARGE", 413);
  try {
    return schema.parse(JSON.parse(text));
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    throw new DomainError("MALFORMED_JSON", 400);
  }
}
export async function boundedForm(
  req: Request,
  maxBytes: number,
): Promise<FormData> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes)
    throw new DomainError("AUDIO_SIZE_LIMIT", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new DomainError("AUDIO_FILE_REQUIRED", 400);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DomainError("AUDIO_SIZE_LIMIT", 413);
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new DomainError("MALFORMED_AUDIO_UPLOAD", 400);
  }
}
