import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import OpenAI from "openai";
import { DomainError } from "../errors";
export type ModelRequest = {
  role: "planner" | "writer";
  system: string;
  payload: unknown;
  schema: z.ZodType;
  signal?: AbortSignal;
  repair?: { codes: string[]; previous: unknown };
};
export interface ModelProvider {
  modelId: string;
  invoke(request: ModelRequest): Promise<unknown>;
}
export class GeminiProvider implements ModelProvider {
  modelId: string;
  constructor() {
    this.modelId = process.env.GEMINI_MODEL_ID ?? "";
  }
  async invoke(req: ModelRequest): Promise<unknown> {
    if (!process.env.GEMINI_API_KEY || !this.modelId)
      throw new DomainError("GEMINI_NOT_CONFIGURED", 503);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const payload = req.repair
      ? {
          ...(req.payload as object),
          structuralRepair: {
            instruction:
              "Correct JSON STRUCTURE ONLY. Do not add facts or actions. Missing evidence remains null and unresolved.",
            ...req.repair,
          },
        }
      : req.payload;
    try {
      const response = await ai.models.generateContent({
        model: this.modelId,
        contents: JSON.stringify(payload),
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(req.schema),
          temperature: 0,
          maxOutputTokens: 8192,
          abortSignal: req.signal,
          httpOptions: { timeout: 18000, retryOptions: { attempts: 1 } },
        },
      });
      if (!response.text) throw new DomainError("MODEL_REFUSED_OR_EMPTY", 502);
      try {
        return JSON.parse(response.text);
      } catch {
        throw new DomainError("MODEL_INVALID_JSON", 502);
      }
    } catch (e) {
      if (e instanceof DomainError) throw e;
      const x = e as { status?: number; name?: string };
      throw new DomainError(
        x.status === 429 || (x.status ?? 0) >= 500 || x.name === "AbortError"
          ? "GEMINI_TRANSIENT_FAILURE"
          : "GEMINI_REQUEST_FAILED",
        502,
      );
    }
  }
}
export class OpenAIProvider implements ModelProvider {
  modelId = process.env.OPENAI_MODEL_ID ?? "";
  async invoke(req: ModelRequest): Promise<unknown> {
    if (
      process.env.OPENAI_FALLBACK_ENABLED !== "true" ||
      !process.env.OPENAI_API_KEY ||
      !this.modelId
    )
      throw new DomainError("FALLBACK_NOT_CONFIGURED", 503);
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 12000,
    });
    try {
      const response = await client.responses.create(
        {
          model: this.modelId,
          instructions: req.system,
          input: JSON.stringify(
            req.repair
              ? { ...(req.payload as object), structuralRepair: req.repair }
              : req.payload,
          ),
          store: false,
          max_output_tokens: 8192,
          text: {
            format: {
              type: "json_schema",
              name: `daybook_${req.role}`,
              strict: true,
              schema: z.toJSONSchema(req.schema),
            },
          },
        },
        { signal: req.signal },
      );
      if (response.status !== "completed" || !response.output_text)
        throw new DomainError("FALLBACK_REFUSED_OR_INCOMPLETE", 502);
      try {
        return JSON.parse(response.output_text);
      } catch {
        throw new DomainError("MODEL_INVALID_JSON", 502);
      }
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError("FALLBACK_REQUEST_FAILED", 502);
    }
  }
}
