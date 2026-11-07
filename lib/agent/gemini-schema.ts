import { z } from "zod";

/** Gemini's decoding schema is a projection; Zod still enforces the full contract.
 * Large bounded nested arrays are rejected by the configured Gemini model.
 * Array limits, string bounds and patterns remain enforced after generation.
 */
export function geminiResponseSchema(
  schema: z.ZodType,
): Record<string, unknown> {
  const omitted = new Set([
    "$schema",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
  ]);
  function convert(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (omitted.has(key)) return [];
        if (key === "const") return [["enum", [item]]];
        if (key === "properties" || key === "$defs") {
          return [
            [
              key,
              Object.fromEntries(
                Object.entries(item as Record<string, unknown>).map(
                  ([name, child]) => [name, convert(child)],
                ),
              ),
            ],
          ];
        }
        return [[key, convert(item)]];
      }),
    );
  }
  return convert(z.toJSONSchema(schema)) as Record<string, unknown>;
}
