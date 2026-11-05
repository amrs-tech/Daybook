import { writeFile, mkdir } from "node:fs/promises";
import { GeminiProvider } from "../lib/agent/providers";
import { PlannerSchema } from "../lib/agent/contracts";
import { SYSTEM_PROMPT } from "../lib/agent/prompts/planner-v2.1";
const checks: Record<string, unknown> = { date: new Date().toISOString() };
if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL_ID) {
  try {
    const provider = new GeminiProvider();
    const response = await provider.invoke({
      role: "planner",
      system: SYSTEM_PROMPT,
      payload: {
        confirmedText: "Hello, thanks!",
        sourceVersion: 1,
        referenceInstant: new Date().toISOString(),
        timezone: "Asia/Kolkata",
        supportedKinds: [],
        accountAliases: [],
        contacts: [],
      },
      schema: PlannerSchema,
    });
    PlannerSchema.parse(response);
    checks.gemini = {
      status: "verified_schema_response",
      modelId: provider.modelId,
    };
  } catch (e) {
    checks.gemini = {
      status: "failed",
      code: e instanceof Error ? e.message : "error",
    };
  }
} else
  checks.gemini = {
    status: "blocked",
    reason: "GEMINI_API_KEY and/or GEMINI_MODEL_ID absent",
  };
checks.elevenlabs = {
  status: "blocked",
  reason: process.env.ELEVENLABS_API_KEY
    ? "Run an actual authorized audio transcription journey; key presence does not verify Scribe"
    : "ELEVENLABS_API_KEY absent",
};
checks.langfuse = {
  status: "blocked",
  reason: process.env.LANGFUSE_SECRET_KEY
    ? "Export and then retrieve a real investigation trace; configuration alone is not proof"
    : "Langfuse credentials absent",
};
checks.supabase = {
  status: "blocked",
  reason: process.env.NEXT_PUBLIC_SUPABASE_URL
    ? "Run two distinct authenticated sessions and hosted PostgreSQL tests"
    : "Supabase URL/key and hosted database connection absent",
};
checks.vercel = {
  status: "blocked",
  reason: "No Vercel deployment credential/project was provided",
};
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/provider-preflight.json",
  JSON.stringify(checks, null, 2),
);
console.log(JSON.stringify(checks, null, 2));
