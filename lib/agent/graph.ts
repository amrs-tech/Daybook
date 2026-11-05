import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";
import type { Context } from "../ledger/types";
import { DomainError, requireThat } from "../errors";
import { planner } from "./planner";
import { writer } from "./writer";
import { authorizeLookups, type Lookups } from "./tool-registry";
import {
  kinds,
  lookupKinds,
  PlannerSchema,
  WriterSchema,
  validatePlanner,
  validateWriter,
  type PlannerOutput,
  type WriterOutput,
} from "./contracts";
import type { ModelProvider, ModelRequest } from "./providers";
import { OpenAIProvider } from "./providers";
import { SYSTEM_PROMPT as plannerPrompt } from "./prompts/planner-v2.1";
import { SYSTEM_PROMPT as writerPrompt } from "./prompts/writer-v2.1";
import { traced } from "../observability/langfuse";
export type Event = {
  role: string;
  outcome: string;
  durationMs: number;
  summary: string;
};
const State = Annotation.Root({
  planner: Annotation<PlannerOutput>,
  writer: Annotation<WriterOutput>,
  lookups: Annotation<Lookups>,
});
export async function runAgents(
  input: {
    confirmedText: string;
    sourceVersion: number;
    referenceInstant: string;
    context: Context;
    traceId: string;
  },
  provider: ModelProvider,
  fallback?: ModelProvider,
) {
  requireThat(
    input.confirmedText.length > 0 && input.confirmedText.length <= 8000,
    "INPUT_LIMIT",
    400,
  );
  const events: Event[] = [];
  let calls = 0,
    repairs = 0;
  const started = Date.now(),
    modelsUsed: { planner?: string; writer?: string } = {},
    signal = AbortSignal.timeout(45000);
  const invoke = async (req: ModelRequest) => {
    requireThat(
      ++calls <= 3 && Date.now() - started < 45000,
      "MODEL_BUDGET_EXCEEDED",
      503,
    );
    try {
      const result = await provider.invoke({ ...req, signal });
      modelsUsed[req.role] = provider.modelId;
      return result;
    } catch (e) {
      const eligible =
        e instanceof DomainError && e.code === "GEMINI_TRANSIENT_FAILURE";
      const selected =
        fallback ??
        (process.env.OPENAI_FALLBACK_ENABLED === "true" &&
        process.env.OPENAI_API_KEY &&
        process.env.OPENAI_MODEL_ID
          ? new OpenAIProvider()
          : undefined);
      if (!eligible || !selected) throw e;
      requireThat(
        ++calls <= 3 && Date.now() - started < 35000,
        "MODEL_BUDGET_EXCEEDED",
        503,
      );
      const result = await traced(
        "daybook.eligible_fallback",
        input.traceId,
        { modelId: selected.modelId },
        () => selected.invoke({ ...req, signal }),
      );
      modelsUsed[req.role] = selected.modelId;
      return result;
    }
  };
  async function callValidated(
    role: "planner" | "writer",
    payload: Record<string, unknown>,
    plan?: PlannerOutput,
  ): Promise<PlannerOutput | WriterOutput> {
    const schema = role === "planner" ? PlannerSchema : WriterSchema,
      system = role === "planner" ? plannerPrompt : writerPrompt;
    let raw: unknown;
    try {
      raw = await invoke({ role, system, payload, schema });
      return role === "planner"
        ? validatePlanner(raw, input.confirmedText)
        : validateWriter(raw, plan!, input.confirmedText);
    } catch (e) {
      // Only structural errors may be repaired. Semantic evidence errors never get guessed away.
      if (
        (e instanceof z.ZodError ||
          (e instanceof DomainError && e.code === "MODEL_INVALID_JSON")) &&
        repairs++ === 0
      ) {
        const codes =
          e instanceof z.ZodError
            ? e.issues.map((i) => i.code)
            : ["invalid_json"];
        raw = await invoke({
          role,
          system,
          payload,
          schema,
          repair: { codes, previous: raw ?? null },
        });
        return role === "planner"
          ? validatePlanner(raw, input.confirmedText)
          : validateWriter(raw, plan!, input.confirmedText);
      }
      throw e;
    }
  }
  async function node<T>(role: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      const result = await traced(
        role,
        input.traceId,
        { modelId: provider.modelId, promptVersion: `daybook-${role}-v2.1` },
        fn,
      );
      events.push({
        role,
        outcome: "complete",
        durationMs: Date.now() - t,
        summary:
          role === "lookup"
            ? "Owner-scoped read-only lookup round"
            : "Validated structured output",
      });
      return result;
    } catch (e) {
      events.push({
        role,
        outcome: "failed",
        durationMs: Date.now() - t,
        summary: e instanceof DomainError ? e.code : "INVALID_STRUCTURE",
      });
      throw e;
    }
  }
  const payload = {
    confirmedText: input.confirmedText,
    sourceVersion: input.sourceVersion,
    referenceInstant: input.referenceInstant,
    timezone: input.context.timezone,
    supportedKinds: kinds,
    lookupAllowlist: lookupKinds,
    accountAliases: input.context.accounts
      .filter((a) => ["bank", "cash"].includes(a.kind))
      .map((a) => a.label),
    contacts: input.context.contacts.map((c) => c.label),
  };
  const graph = new StateGraph(State)
    .addNode("planner_agent", async () => ({
      planner: (await node("planner", () =>
        callValidated("planner", payload),
      )) as PlannerOutput,
    }))
    .addNode("authorized_lookups", async (state) => ({
      lookups: await node("lookup", async () =>
        authorizeLookups(state.planner, input.context),
      ),
    }))
    .addNode("writer_agent", async (state) => ({
      writer: (await node("writer", () =>
        callValidated(
          "writer",
          {
            ...payload,
            verifiedPlannerSteps: state.planner,
            allowedDraftKinds: kinds.filter((k) => k !== "query"),
            allowedFormFieldsByKind: z.toJSONSchema(WriterSchema),
            lookupResults: state.lookups,
            confirmedDefaults: input.context.defaults,
          },
          state.planner,
        ),
      )) as WriterOutput,
    }))
    .addEdge(START, "planner_agent")
    .addEdge("planner_agent", "authorized_lookups")
    .addEdge("authorized_lookups", "writer_agent")
    .addEdge("writer_agent", END)
    .compile();
  try {
    const result = await graph.invoke(
      {},
      { recursionLimit: 8, signal: AbortSignal.timeout(48000) },
    );
    return {
      ...result,
      events,
      modelCalls: calls,
      modelId: provider.modelId,
      plannerModelId: modelsUsed.planner,
      writerModelId: modelsUsed.writer,
    };
  } catch (e) {
    Object.assign(e instanceof Error ? e : new Error("Agent failed"), {
      events,
    });
    throw e;
  }
}
