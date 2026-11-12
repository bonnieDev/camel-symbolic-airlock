import type { z } from "zod";
import type { ProvenanceEnvelope } from "../index";
import { CaMeLGatekeeperVerifier } from "./camel-provenance";
import { exportGuardedSchemaToMcp } from "./mcp-schema-exporter";

export type GuardedToolHandler<TArgs = any, TResult = any> = (
  unwrappedArgs: TArgs,
  envelopes: Record<keyof TArgs, ProvenanceEnvelope>
) => Promise<TResult>;

export interface ArgumentPolicy {
  /** Zod schema the unwrapped value must satisfy, e.g. a closed enum. */
  schema: z.ZodTypeAny;
  /** True for control arguments that must come from a human's signed choice. */
  requireTrustedEnum: boolean;
  /** Free-text label for documentation, e.g. "CONTROL_ACTION". */
  role?: string;
}

export type ToolPolicyMap = Record<string, ArgumentPolicy>;

interface RegisteredTool {
  description: string;
  handler: GuardedToolHandler;
  policy: ToolPolicyMap;
}

export class CaMeLMcpToolRegistry {
  private verifier: CaMeLGatekeeperVerifier;
  private tools: Map<string, RegisteredTool> = new Map();

  constructor(verifier: CaMeLGatekeeperVerifier) {
    this.verifier = verifier;
  }

  public registerGuardedTool(params: {
    name: string;
    description: string;
    policyMap: ToolPolicyMap;
    handler: GuardedToolHandler;
  }) {
    this.tools.set(params.name, {
      description: params.description,
      handler: params.handler,
      policy: params.policyMap,
    });
  }

  /** Tool list in the shape an MCP `tools/list` response expects. */
  public getToolsListResponse() {
    const tools = [...this.tools.entries()].map(([name, def]) => ({
      name,
      description: `${def.description} [Guarded: every argument must be a signed provenance envelope.]`,
      inputSchema: exportGuardedSchemaToMcp(def.policy),
    }));
    return { tools };
  }

  public async executeToolCall(
    toolName: string,
    rawArgs: Record<string, unknown>
  ) {
    const toolDef = this.tools.get(toolName);
    if (!toolDef) throw new Error(`Tool ${toolName} not found.`);

    const unwrapped: Record<string, unknown> = {};
    const envelopes: Record<string, ProvenanceEnvelope> = {};

    for (const [key, rule] of Object.entries(toolDef.policy)) {
      const candidate = rawArgs[key];
      if (!candidate || typeof candidate !== "object") {
        throw new Error(
          `[CaMeL Security Violation] Argument '${key}' must be wrapped in a signed ProvenanceEnvelope.`
        );
      }

      const check = this.verifier.checkEnvelope(candidate);
      if (!check.valid) {
        throw new Error(
          `[CaMeL Signature Error] Envelope for '${key}' was rejected: ${check.reason}`
        );
      }
      const envelope = candidate as ProvenanceEnvelope;

      if (
        rule.requireTrustedEnum &&
        envelope.provenance !== "TRUSTED_SYSTEM_ENUM"
      ) {
        throw new Error(
          `[CaMeL Policy Violation] Argument '${key}' requires TRUSTED_SYSTEM_ENUM provenance.`
        );
      }

      // The value itself must be on the tool's allowed list.
      const parsedValue = rule.schema.safeParse(envelope.value);
      if (!parsedValue.success) {
        throw new Error(
          `[CaMeL Schema Violation] Argument '${key}' has a value this tool does not allow.`
        );
      }

      unwrapped[key] = parsedValue.data;
      envelopes[key] = envelope;
    }

    return await toolDef.handler(unwrapped, envelopes);
  }
}
