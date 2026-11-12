import crypto from "node:crypto";
import { z } from "zod";
import {
  CaMeLGatekeeperVerifier,
  CaMeLMcpToolRegistry,
  CaMeLProvenanceAuthority,
  createSymbolicRouter,
} from "../src/server/index";

/**
 * Shared setup for the demo and the tests: one small "maintenance" tool,
 * the words that can and cannot be trusted to describe it, and the keys.
 */

export const ACTION_SYMBOLS = [
  "ARCHIVE_SOFT_DELETE",
  "NORMALIZE_WHITESPACE",
  "DEDUPLICATE_BY_HASH",
] as const;

export const RECORD_LIMIT = { min: 1, max: 50 };

// Note what is absent: there is no "delete everything" action to land on.
export const router = createSymbolicRouter({
  actions: [
    { symbol: "ARCHIVE_SOFT_DELETE", phrases: ["archive"], limit: RECORD_LIMIT },
    {
      symbol: "NORMALIZE_WHITESPACE",
      phrases: ["normalize whitespace", "trim whitespace"],
      limit: RECORD_LIMIT,
    },
    {
      symbol: "DEDUPLICATE_BY_HASH",
      phrases: ["deduplicate", "dedupe", "remove duplicates"],
      limit: RECORD_LIMIT,
    },
  ],
  ambiguousVerbs: {
    clean: [...ACTION_SYMBOLS],
    tidy: [...ACTION_SYMBOLS],
    fix: ["NORMALIZE_WHITESPACE", "DEDUPLICATE_BY_HASH"],
    purge: ["ARCHIVE_SOFT_DELETE", "DEDUPLICATE_BY_HASH"],
  },
});

export function createDemoSystem() {
  const gatewayKeys = crypto.generateKeyPairSync("ed25519");
  const subagentKeys = crypto.generateKeyPairSync("ed25519");
  const pem = (key: crypto.KeyObject, type: "spki" | "pkcs8") =>
    key.export({ type, format: "pem" }).toString();

  const verifier = new CaMeLGatekeeperVerifier({
    UI_AIRLOCK_GATEWAY: pem(gatewayKeys.publicKey, "spki"),
    QUARANTINED_SUBAGENT: pem(subagentKeys.publicKey, "spki"),
  });

  const gateway = new CaMeLProvenanceAuthority(
    "UI_AIRLOCK_GATEWAY",
    pem(gatewayKeys.privateKey, "pkcs8")
  );
  const subagent = new CaMeLProvenanceAuthority(
    "QUARANTINED_SUBAGENT",
    pem(subagentKeys.privateKey, "pkcs8")
  );

  const registry = new CaMeLMcpToolRegistry(verifier);
  registry.registerGuardedTool({
    name: "run_maintenance",
    description: "Runs one bounded maintenance action on staging records.",
    policyMap: {
      actionSymbol: {
        schema: z.enum(ACTION_SYMBOLS),
        requireTrustedEnum: true,
        role: "CONTROL_ACTION",
      },
      maxRecords: {
        schema: z.number().int().min(RECORD_LIMIT.min).max(RECORD_LIMIT.max),
        requireTrustedEnum: true,
        role: "CONTROL_LIMIT",
      },
    },
    handler: async (args: { actionSymbol: string; maxRecords: number }) => ({
      executed: args.actionSymbol,
      maxRecords: args.maxRecords,
    }),
  });

  /** What the gateway does after a person clicks: validate, then sign. */
  function signChoice(choice: { actionSymbol: string; limit?: number }) {
    const intent = router.resolve(choice);
    return {
      actionSymbol: gateway.mintEnvelope({
        value: intent.actionSymbol,
        requestedProvenance: "TRUSTED_SYSTEM_ENUM",
        allowedReaders: ["*"],
      }),
      maxRecords: gateway.mintEnvelope({
        value: intent.limit,
        requestedProvenance: "TRUSTED_SYSTEM_ENUM",
        allowedReaders: ["*"],
      }),
    };
  }

  return { verifier, gateway, subagent, subagentKeys, registry, signChoice };
}
