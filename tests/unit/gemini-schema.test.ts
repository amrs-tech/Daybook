import { describe, expect, it } from "vitest";
import { z } from "zod";
import { geminiResponseSchema } from "../../lib/agent/gemini-schema";
import { PlannerSchema } from "../../lib/agent/contracts";
import { replayFixtures } from "../../lib/agent/replay";

describe("Gemini structured-output compatibility", () => {
  it("keeps literal versions and strict object fields in the provider schema", () => {
    const schema = geminiResponseSchema(PlannerSchema) as any;
    expect(schema.properties.schemaVersion).toEqual({
      type: "string",
      enum: ["2.1"],
    });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.steps.items.properties.kind.enum).toContain(
      "expense",
    );
    expect(schema.properties.steps.maxItems).toBeUndefined();
  });
  it("preserves property names that happen to match schema keywords", () => {
    const schema = geminiResponseSchema(
      z.object({ pattern: z.literal("kept"), maxItems: z.number() }),
    ) as any;
    expect(schema.properties.pattern.enum).toEqual(["kept"]);
    expect(schema.properties.maxItems.type).toBe("number");
  });
  it("still rejects oversized batches, invalid step references and extra fields locally", () => {
    const plan = structuredClone(replayFixtures[0].planner);
    expect(
      PlannerSchema.safeParse({ ...plan, steps: Array(21).fill(plan.steps[0]) })
        .success,
    ).toBe(false);
    plan.steps[0].stepRef = "invalid";
    expect(PlannerSchema.safeParse(plan).success).toBe(false);
    expect(
      PlannerSchema.safeParse({ ...replayFixtures[0].planner, sql: "injected" })
        .success,
    ).toBe(false);
  });
});
