import { requireThat } from "../errors";
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_MS = 45000;
/** Verify container magic, declared lengths, PCM format and actual frame duration. */
export function inspectWav(
  data: Uint8Array,
  mime: string,
): { durationMs: number; sampleRate: number } {
  requireThat(
    data.byteLength > 44 && data.byteLength <= MAX_AUDIO_BYTES,
    "AUDIO_SIZE_LIMIT",
    413,
  );
  requireThat(
    ["audio/wav", "audio/x-wav", "audio/wave"].includes(mime.split(";")[0]),
    "UNSUPPORTED_AUDIO_FORMAT",
    415,
  );
  const b = Buffer.from(data);
  requireThat(
    b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE" &&
      b.readUInt32LE(4) === b.length - 8,
    "INVALID_AUDIO_CONTAINER",
    422,
  );
  let pos = 12,
    rate = 0,
    channels = 0,
    block = 0,
    bytes = -1,
    fmt = false;
  while (pos + 8 <= b.length) {
    const name = b.toString("ascii", pos, pos + 4),
      length = b.readUInt32LE(pos + 4);
    pos += 8;
    requireThat(pos + length <= b.length, "INVALID_AUDIO_CONTAINER");
    if (name === "fmt ") {
      requireThat(
        !fmt &&
          length >= 16 &&
          b.readUInt16LE(pos) === 1 &&
          b.readUInt16LE(pos + 14) === 16,
        "UNSUPPORTED_AUDIO_ENCODING",
      );
      fmt = true;
      channels = b.readUInt16LE(pos + 2);
      rate = b.readUInt32LE(pos + 4);
      block = b.readUInt16LE(pos + 12);
      requireThat(
        channels >= 1 &&
          channels <= 2 &&
          rate >= 8000 &&
          rate <= 48000 &&
          block === channels * 2 &&
          b.readUInt32LE(pos + 8) === rate * block,
        "UNSUPPORTED_AUDIO_ENCODING",
      );
    }
    if (name === "data") {
      requireThat(bytes === -1, "INVALID_AUDIO_CONTAINER");
      bytes = length;
    }
    pos += length + (length % 2);
  }
  requireThat(
    fmt && bytes > 0 && bytes % block === 0 && pos === b.length,
    "INVALID_AUDIO_CONTAINER",
  );
  const durationMs = Math.ceil((bytes / (rate * block)) * 1000);
  requireThat(
    durationMs >= 100 && durationMs <= MAX_AUDIO_MS,
    "AUDIO_DURATION_LIMIT",
  );
  return { durationMs, sampleRate: rate };
}
