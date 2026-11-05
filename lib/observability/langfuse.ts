import { startActiveObservation } from "@langfuse/tracing";
import { DomainError } from "../errors";
type Metadata = Record<string, string | number | boolean>;
let processor: { forceFlush: () => Promise<void> } | undefined;
export function setProcessor(p: typeof processor) {
  processor = p;
}
export function redactedMetadata(metadata: Metadata): Metadata {
  const allowed = new Set([
    "modelId",
    "promptVersion",
    "stepCount",
    "version",
    "status",
    "durationMs",
    "investigationId",
    "errorCode",
    "tokenCount",
  ]);
  return Object.fromEntries(
    Object.entries(metadata).filter(([k]) => allowed.has(k)),
  );
}
export async function traced<T>(
  name: string,
  investigationId: string,
  metadata: Metadata,
  fn: () => Promise<T>,
): Promise<T> {
  // Reuse the same promise even if instrumentation fails before/after its callback.
  // An exporter/context error can NEVER invoke a financial function twice.
  let operation: Promise<T> | undefined;
  const execute = () => (operation ??= Promise.resolve().then(fn));
  try {
    return await startActiveObservation(
      name.startsWith("daybook.") ? name : `daybook.${name}`,
      async (observation) => {
        try {
          observation.update({
            metadata: { ...redactedMetadata(metadata), investigationId },
          });
        } catch {}
        try {
          const result = await execute();
          try {
            observation.update({ metadata: { status: "complete" } });
          } catch {}
          return result;
        } catch (e) {
          try {
            observation.update({
              metadata: {
                status: "failed",
                errorCode:
                  e instanceof DomainError ? e.code : "UNEXPECTED_ERROR",
              },
            });
          } catch {}
          throw e;
        }
      },
    );
  } catch {
    return execute();
  }
}
export async function flushTraces() {
  if (!processor) return;
  // Bounded exporter wait. Timeout does not change business state or trigger retries.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      processor.forceFlush(),
      new Promise<void>((r) => {
        timer = setTimeout(r, 1500);
      }),
    ]);
  } catch {
  } finally {
    if (timer) clearTimeout(timer);
  }
}
