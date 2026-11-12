import { ProvenanceEnvelope } from "../index";
import { CaMeLGatekeeperVerifier } from "./camel-provenance";

export type GuardedToolHandler<TArgs = any, TResult = any> = (
  unwrappedArgs: TArgs,
  envelopes: Record<keyof TArgs, ProvenanceEnvelope>
) => Promise<TResult>;

export class CaMeLMcpToolRegistry {
  private verifier: CaMeLGatekeeperVerifier;
  private tools: Map<string, { handler: GuardedToolHandler; policy: Record<string, any> }> = new Map();

  constructor(verifier: CaMeLGatekeeperVerifier) {
    this.verifier = verifier;
  }

  public registerGuardedTool(params: {
    name: string;
    description: string;
    policyMap: Record<string, { schema: any; requireTrustedEnum: boolean; role: string }>;
    handler: GuardedToolHandler;
  }) {
    this.tools.set(params.name, { handler: params.handler, policy: params.policyMap });
  }

  public getToolsListResponse() {
    const list: any[] = [];
    for (const [name, def] of this.tools.entries()) {
      list.push({
        name,
        description: `Guarded MCP Tool with CaMeL Provenance & Ambiguity Airlock.`,
      });
    }
    return { tools: list };
  }

  public async executeToolCall(toolName: string, rawArgs: Record<string, unknown>) {
    const toolDef = this.tools.get(toolName);
    if (!toolDef) throw new Error(`Tool ${toolName} not found.`);

    const unwrapped: Record<string, unknown> = {};
    const envelopes: Record<string, ProvenanceEnvelope> = {};

    for (const [key, rule] of Object.entries(toolDef.policy)) {
      const envelope = rawArgs[key] as ProvenanceEnvelope;
      if (!envelope || typeof envelope !== "object" || !envelope.signature) {
        throw new Error(`[CaMeL Security Violation] Argument '${key}' must be wrapped in a signed ProvenanceEnvelope.`);
      }

      if (!this.verifier.verifyEnvelope(envelope)) {
        throw new Error(`[CaMeL Signature Error] Envelope for '${key}' failed Ed25519 signature verification.`);
      }

      if (rule.requireTrustedEnum && envelope.provenance !== "TRUSTED_SYSTEM_ENUM") {
        throw new Error(`[CaMeL Policy Violation] Argument '${key}' requires TRUSTED_SYSTEM_ENUM provenance.`);
      }

      unwrapped[key] = envelope.value;
      envelopes[key] = envelope;
    }

    return await toolDef.handler(unwrapped, envelopes);
  }
}
