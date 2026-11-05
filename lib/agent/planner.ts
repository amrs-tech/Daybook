import {
  PlannerSchema,
  validatePlanner,
  type PlannerOutput,
} from "./contracts";
import { SYSTEM_PROMPT } from "./prompts/planner-v2.1";
import type { ModelProvider } from "./providers";
export async function planner(
  provider: ModelProvider,
  payload: { confirmedText: string } & Record<string, unknown>,
  invoke: (fn: () => Promise<unknown>) => Promise<unknown>,
): Promise<PlannerOutput> {
  const raw = await invoke(() =>
    provider.invoke({
      role: "planner",
      system: SYSTEM_PROMPT,
      payload,
      schema: PlannerSchema,
    }),
  );
  return validatePlanner(raw, payload.confirmedText);
}
