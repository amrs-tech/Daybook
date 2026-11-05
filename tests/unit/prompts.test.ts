import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { SYSTEM_PROMPT as planner } from "../../lib/agent/prompts/planner-v2.1";
import { SYSTEM_PROMPT as writer } from "../../lib/agent/prompts/writer-v2.1";
import manifest from "../../fixtures/prompt-manifest.json";
it("Appendix C and D authoritative runtime prompts retain the extracted contract hashes", () => {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  expect(hash(planner)).toBe(manifest.plannerSha256);
  expect(hash(writer)).toBe(manifest.writerSha256);
  expect(planner).not.toBe(writer);
});
