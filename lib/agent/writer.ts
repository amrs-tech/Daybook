import {
  WriterSchema,
  validateWriter,
  type PlannerOutput,
  type WriterOutput,
} from "./contracts";
import { SYSTEM_PROMPT } from "./prompts/writer-v2.1";
import type { ModelProvider } from "./providers";
export async function writer(
  provider: ModelProvider,
  payload: {
    confirmedText: string;
    verifiedPlannerSteps: PlannerOutput;
  } & Record<string, unknown>,
  invoke: (fn: () => Promise<unknown>) => Promise<unknown>,
): Promise<WriterOutput> {
  const raw = await invoke(() =>
    provider.invoke({
      role: "writer",
      system: SYSTEM_PROMPT,
      payload,
      schema: WriterSchema,
    }),
  );
  return validateWriter(
    raw,
    payload.verifiedPlannerSteps,
    payload.confirmedText,
  );
}
