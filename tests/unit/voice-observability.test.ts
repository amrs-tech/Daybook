import { describe, it, expect, vi, afterEach } from "vitest";
import { inspectWav } from "../../lib/voice/audio";
import { transcribeWav } from "../../lib/voice/elevenlabs";
import {
  redactedMetadata,
  traced,
  setProcessor,
  flushTraces,
} from "../../lib/observability/langfuse";
export function wav(ms = 1000) {
  const n = ms * 16,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
afterEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
  setProcessor(undefined);
});
describe("A19 audio input and provider failures", () => {
  it("validates frame duration from actual PCM bytes", () =>
    expect(inspectWav(wav(), "audio/wav").durationMs).toBe(1000));
  it("rejects spoofed MIME and payloads", () => {
    expect(() => inspectWav(wav(), "audio/webm")).toThrow();
    const b = wav();
    b.write("FAKE", 0);
    expect(() => inspectWav(b, "audio/wav")).toThrow();
  });
  it("rejects oversized duration independently of browser metadata", () =>
    expect(() => inspectWav(wav(46000), "audio/wav")).toThrow(
      "AUDIO_DURATION_LIMIT",
    ));
  it("requires credentials instead of fake transcript", async () =>
    await expect(transcribeWav(wav())).rejects.toThrow("unavailable"));
  it.each([
    [429, "VOICE_QUOTA_EXCEEDED"],
    [401, "VOICE_CONFIGURATION_ERROR"],
    [500, "TRANSCRIPTION_PROVIDER_ERROR"],
  ])("handles provider status %d", async (status, code) => {
    process.env.ELEVENLABS_API_KEY = "synthetic-test-only";
    await expect(
      transcribeWav(
        wav(),
        vi.fn(
          async () => new Response("{}", { status }),
        ) as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code });
  });
  it("handles connection failure without retry", async () => {
    process.env.ELEVENLABS_API_KEY = "synthetic-test-only";
    const fn = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      transcribeWav(wav(), fn as unknown as typeof fetch),
    ).rejects.toThrow("could not finish");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("validates text and strips extra provider data", async () => {
    process.env.ELEVENLABS_API_KEY = "synthetic-test-only";
    const result = await transcribeWav(
      wav(),
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              text: "250 rupees",
              language_code: "en",
              secret: "hidden",
            }),
          ),
      ) as unknown as typeof fetch,
    );
    expect(result).toEqual({
      text: "250 rupees",
      languageCode: "en",
      provider: "elevenlabs",
      model: "scribe_v2",
    });
  });
});
describe("A20 privacy and failure isolation", () => {
  it("drops arbitrary transcript/PII metadata", () =>
    expect(
      redactedMetadata({
        modelId: "test",
        transcript: "private",
        email: "a@b.c",
        account: "secret",
      }),
    ).toEqual({ modelId: "test" }));
  it("tracing executes financial function once even if exporter fails", async () => {
    const commit = vi.fn(async () => ({ receipt: "persisted" }));
    setProcessor({
      forceFlush: async () => {
        throw new Error("offline");
      },
    });
    expect(await traced("daybook.commit", "synthetic", {}, commit)).toEqual({
      receipt: "persisted",
    });
    await flushTraces();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
