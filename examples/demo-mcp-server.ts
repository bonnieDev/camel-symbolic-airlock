import crypto from "node:crypto";
import {
  CaMeLProvenanceAuthority,
  CaMeLGatekeeperVerifier,
  CaMeLMcpToolRegistry,
} from "../src/server/index";

async function runDemo() {
  console.log("Initializing @rmk-systems/camel-symbolic-airlock demo...");

  const gatewayKeys = crypto.generateKeyPairSync("ed25519");
  const subagentKeys = crypto.generateKeyPairSync("ed25519");

  const keyRegistry = {
    UI_AIRLOCK_GATEWAY: gatewayKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    QUARANTINED_SUBAGENT: subagentKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    ORCHESTRATOR_AGENT: "",
    TOOL_EXECUTOR: "",
  };

  const verifier = new CaMeLGatekeeperVerifier(keyRegistry);
  const registry = new CaMeLMcpToolRegistry(verifier);

  registry.registerGuardedTool({
    name: "execute_and_dispatch_report",
    description: "Executes a grounded maintenance symbol and emails the summary.",
    policyMap: {
      actionSymbol: {
        schema: { type: "string" },
        requireTrustedEnum: true,
        role: "CONTROL_ACTION",
      },
      maxRecords: {
        schema: { type: "number" },
        requireTrustedEnum: true,
      },
      recipient: {
        schema: { type: "string" },
        requireTrustedEnum: true,
      },
    },
    handler: async (args, envelopes) => {
      return {
        success: true,
        executed: args,
        lineage: envelopes.actionSymbol.parentHashes,
      };
    },
  });

  const authority = new CaMeLProvenanceAuthority(
    "UI_AIRLOCK_GATEWAY",
    gatewayKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  );

  const signedAction = authority.mintEnvelope({
    value: "ARCHIVE_SOFT_DELETE",
    requestedProvenance: "TRUSTED_SYSTEM_ENUM",
    allowedReaders: ["*"],
  });

  const signedRecords = authority.mintEnvelope({
    value: 25,
    requestedProvenance: "TRUSTED_SYSTEM_ENUM",
    allowedReaders: ["*"],
  });

  const signedRecipient = authority.mintEnvelope({
    value: "SECURITY_AUDIT_LOG",
    requestedProvenance: "TRUSTED_SYSTEM_ENUM",
    allowedReaders: ["*"],
  });

  console.log("Executing tool call with signed Ed25519 envelopes...");
  const result = await registry.executeToolCall("execute_and_dispatch_report", {
    actionSymbol: signedAction,
    maxRecords: signedRecords,
    recipient: signedRecipient,
  });

  console.log("Tool execution result:", result);
}

runDemo().catch(console.error);
