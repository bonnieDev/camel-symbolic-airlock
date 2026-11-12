import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Turns a tool's policy map into the JSON Schema an MCP client sees.
 * Each argument is described as a signed envelope around the real value.
 */
export function exportGuardedSchemaToMcp(
  policyMap: Record<
    string,
    { schema: z.ZodTypeAny; requireTrustedEnum: boolean; role?: string }
  >
) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, rule] of Object.entries(policyMap)) {
    const jsonSchema = zodToJsonSchema(rule.schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    });
    properties[key] = {
      type: "object",
      description: `[Provenance envelope] Role: ${rule.role ?? "PARAMETER"}. Requires a human-signed trusted value: ${rule.requireTrustedEnum}.`,
      properties: {
        value: jsonSchema,
        provenance: rule.requireTrustedEnum
          ? { type: "string", const: "TRUSTED_SYSTEM_ENUM" }
          : {
              type: "string",
              enum: [
                "TRUSTED_SYSTEM_ENUM",
                "UNTRUSTED_Q_LLM_EXTRACTED",
                "INTERNAL_DERIVED_TRANSFORM",
              ],
            },
        allowedReaders: { type: "array", items: { type: "string" } },
        signature: { type: "string" },
        signerRole: { type: "string" },
        timestamp: { type: "number" },
        parentHashes: { type: "array", items: { type: "string" } },
      },
      required: [
        "value",
        "provenance",
        "allowedReaders",
        "signature",
        "signerRole",
        "timestamp",
        "parentHashes",
      ],
    };
    required.push(key);
  }

  return {
    type: "object" as const,
    properties,
    required,
  };
}
