export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    !process.env.LANGFUSE_PUBLIC_KEY ||
    !process.env.LANGFUSE_SECRET_KEY
  )
    return;
  try {
    const [
      { NodeTracerProvider },
      { LangfuseSpanProcessor },
      { setProcessor },
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@langfuse/otel"),
      import("./lib/observability/langfuse"),
    ]);
    const processor = new LangfuseSpanProcessor({
      mediaUploadEnabled: false,
      timeout: 2,
      flushAt: 1,
      // No transcript, audio, arbitrary descriptions or SDK-captured content leaves the app.
      // Only our manually instrumented spans are exported. We never set input/output.
      // Metadata is independently allowlisted before reaching the SDK.
      mask: ({ data }) =>
        typeof data === "string" && data.length > 180
          ? "[content omitted]"
          : data,
      shouldExportSpan: ({ otelSpan }) => otelSpan.name.startsWith("daybook."),
    });
    const sdk = new NodeTracerProvider({ spanProcessors: [processor] });
    sdk.register();
    setProcessor(processor);
  } catch {
    /* Trace setup failure cannot prevent authenticated ledger use. */
  }
}
