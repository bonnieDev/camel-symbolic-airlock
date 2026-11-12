import { zodToJsonSchema } from "zod-to-json-schema";

export function exportGuardedSchemaToMcp(policyMap: Record<string, any>) {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, rule] of Object.entries(policyMap)) {
    const jsonSchema = zodToJsonSchema(rule.schema, { target: "jsonSchema7" });
    properties[key] = {
      type: "object",
      description: `[CaMeL Provenance Wrapper] Role: ${rule.role}, Requires Trusted Enum: ${rule.requireTrustedEnum}`,
      properties: {
        value: jsonSchema,
        provenance: { type: "string", enum: ["TRUSTED_SYSTEM_ENUM", "UNTRUSTED_Q_LLM_EXTRACTED", "INTERNAL_DERIVED_TRANSFORM"] },
        allowedReaders: { type: "array", items: { type: "string" } },
        signature: { type: "string" },
        signerRole: { type: "string" },
        timestamp: { type: "number" },
        parentHashes: { type: "array", items: { type: "string" } },
      },
      required: ["value", "provenance", "allowedReaders", "signature", "signerRole", "timestamp", "parentHashes"],
    };
    required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
  };
}
