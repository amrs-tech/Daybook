"use client";
import { useState, useRef, useEffect } from "react";
import { Mic, Square, Pause, Play, X, ArrowUp, AudioLines } from "lucide-react";
async function toWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > 45.05)
      throw new Error(
        "Recording exceeds 45 seconds. Please record a shorter clip.",
      );
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(audio.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering(),
      samples = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2),
      view = new DataView(buffer);
    const chars = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    };
    chars(0, "RIFF");
    view.setUint32(4, buffer.byteLength - 8, true);
    chars(8, "WAVE");
    chars(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    chars(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((x, i) =>
      view.setInt16(
        44 + i * 2,
        Math.round(Math.max(-1, Math.min(1, x)) * (x < 0 ? 32768 : 32767)),
        true,
      ),
    );
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
export default function Recorder({
  available,
  onTranscript,
  onError,
}: {
  available: boolean;
  onTranscript: (text: string, id: string) => void;
  onError: (s: string) => void;
}) {
  const [status, setStatus] = useState<
      "idle" | "recording" | "paused" | "ready" | "uploading"
    >("idle"),
    [seconds, setSeconds] = useState(0),
    [clip, setClip] = useState<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    cancelled = useRef(false),
    elapsed = useRef(0),
    request = useRef("");
  useEffect(
    () => () => {
      cancelled.current = true;
      recorder.current?.state !== "inactive" && recorder.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (status !== "recording") return;
    const tick = setInterval(() => {
      elapsed.current++;
      setSeconds(elapsed.current);
      if (elapsed.current >= 45) recorder.current?.stop();
    }, 1000);
    return () => clearInterval(tick);
  }, [status]);
  async function start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Recording is not supported in this browser. Use typed input.",
        );
      cancelled.current = false;
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime)
        throw new Error("No supported microphone format. Use typed input.");
      const rec = new MediaRecorder(stream.current, { mimeType: mime });
      recorder.current = rec;
      chunks.current = [];
      elapsed.current = 0;
      setSeconds(0);
      setClip(null);
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (cancelled.current) {
          setStatus("idle");
          return;
        }
        setClip(new Blob(chunks.current, { type: mime }));
        setStatus("ready");
      };
      rec.onerror = () => {
        onError("Microphone recording failed. Please try typed input.");
        cancel();
      };
      rec.start(500);
      setStatus("recording");
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      onError(
        e instanceof Error ? e.message : "Microphone permission was denied.",
      );
      setStatus("idle");
    }
  }
  function cancel() {
    cancelled.current = true;
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    chunks.current = [];
    setClip(null);
    setStatus("idle");
    setSeconds(0);
  }
  async function upload() {
    if (!clip) return;
    setStatus("uploading");
    try {
      const wav = await toWav(clip);
      request.current ||= crypto.randomUUID();
      const form = new FormData();
      form.append("audio", wav, "recording.wav");
      form.append("clientRequestId", request.current);
      const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: form,
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Transcription failed.");
      onTranscript(result.data.text, result.data.transcriptionId);
      setClip(null);
      request.current = "";
      setStatus("idle");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Transcription failed.");
      setStatus("ready");
    }
  }
  return (
    <div className="voice-box">
      <div className={`mic-orb ${status === "recording" ? "recording" : ""}`}>
        <AudioLines size={32} />
      </div>
      <h3>
        {status === "recording"
          ? "Listening to you…"
          : status === "paused"
            ? "Take your time."
            : status === "ready"
              ? "Ready when you are."
              : "Say it. We’ll sort it."}
      </h3>
      <p>
        {status === "ready"
          ? "Your clip stays on this device until you choose Transcribe."
          : "Record up to 45 seconds, then review every word before interpreting."}
      </p>
      {status === "idle" && (
        <button className="button dark" onClick={start}>
          <Mic size={16} />
          Start recording
        </button>
      )}
      {(status === "recording" || status === "paused") && (
        <div className="row center">
          <span className="record-time">
            00:{seconds.toString().padStart(2, "0")}
          </span>
          <button
            className="button secondary"
            onClick={() => {
              if (status === "recording") {
                recorder.current?.pause();
                setStatus("paused");
              } else {
                recorder.current?.resume();
                setStatus("recording");
              }
            }}
          >
            {status === "paused" ? <Play size={15} /> : <Pause size={15} />}{" "}
            {status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            className="button dark"
            onClick={() => recorder.current?.stop()}
          >
            <Square size={14} />
            Stop
          </button>
          <button
            className="icon-button"
            aria-label="Cancel recording"
            onClick={cancel}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {(status === "ready" || status === "uploading") && (
        <div className="row center">
          <button
            className="button dark"
            disabled={status === "uploading" || !available}
            onClick={upload}
          >
            <ArrowUp size={16} />
            {status === "uploading" ? "Transcribing…" : "Transcribe clip"}
          </button>
          <button
            className="button secondary"
            disabled={status === "uploading"}
            onClick={cancel}
          >
            Discard
          </button>
        </div>
      )}
      {!available && (
        <small className="voice-unavailable">
          Scribe isn’t configured. Recording can be tried locally; transcription
          requires an ElevenLabs key.
        </small>
      )}
      <small>
        Audio is discarded by DayBook after transcription. Provider retention
        policies apply.
      </small>
    </div>
  );
}
