import { z } from "zod";
import { DomainError } from "../errors";
export async function transcribeWav(
  audio: Uint8Array,
  fetcher: typeof fetch = fetch,
) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key)
    throw new DomainError(
      "VOICE_NOT_CONFIGURED",
      503,
      "Voice transcription is unavailable. You can still type your instruction.",
    );
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
    "recording.wav",
  );
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");
  let response: Response;
  try {
    response = await fetcher("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new DomainError(
      "TRANSCRIPTION_TIMEOUT",
      503,
      "Transcription could not finish. Retry or use typed input.",
    );
  }
  if (response.status === 429)
    throw new DomainError(
      "VOICE_QUOTA_EXCEEDED",
      429,
      "Speech provider quota is exhausted. Use typed input.",
    );
  if (response.status === 401 || response.status === 403)
    throw new DomainError("VOICE_CONFIGURATION_ERROR", 503);
  if (!response.ok) throw new DomainError("TRANSCRIPTION_PROVIDER_ERROR", 502);
  const parsed = z
    .object({
      text: z.string().min(1).max(8000),
      language_code: z.string().optional(),
    })
    .safeParse(await response.json());
  if (!parsed.success)
    throw new DomainError("INVALID_TRANSCRIPTION_RESPONSE", 502);
  return {
    text: parsed.data.text,
    languageCode: parsed.data.language_code,
    provider: "elevenlabs" as const,
    model: "scribe_v2" as const,
  };
}
