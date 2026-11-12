import crypto from "node:crypto";
import { z } from "zod";
import type { CaMeLProvenanceLevel, ProvenanceEnvelope } from "../index";

export type AllowedRole =
  | "UI_AIRLOCK_GATEWAY"
  | "ORCHESTRATOR_AGENT"
  | "QUARANTINED_SUBAGENT"
  | "TOOL_EXECUTOR";

/** The only role allowed to sign TRUSTED_SYSTEM_ENUM envelopes. */
export const TRUSTED_SIGNER_ROLE: AllowedRole = "UI_AIRLOCK_GATEWAY";

export interface PublicKeyRegistry {
  [role: string]: string; // PEM public keys
}

/** Runtime shape check for envelopes that arrive over the wire. */
export const ProvenanceEnvelopeSchema = z.object({
  value: z.unknown(),
  provenance: z.enum([
    "TRUSTED_SYSTEM_ENUM",
    "UNTRUSTED_Q_LLM_EXTRACTED",
    "INTERNAL_DERIVED_TRANSFORM",
  ]),
  allowedReaders: z.array(z.string()),
  signature: z.string().min(1),
  signerRole: z.string().min(1),
  timestamp: z.number(),
  parentHashes: z.array(z.string()),
});

// Higher number = less trusted. A derived envelope takes the highest rank
// among its parents ("highest watermark"), so trust can only go down.
const TAINT_RANK: Record<CaMeLProvenanceLevel, number> = {
  TRUSTED_SYSTEM_ENUM: 0,
  INTERNAL_DERIVED_TRANSFORM: 1,
  UNTRUSTED_Q_LLM_EXTRACTED: 2,
};

/**
 * The single serialization used for signing, verifying and hashing.
 * Signing and verifying must build exactly the same string, so both go
 * through this function. The signature itself is never part of it.
 *
 * Note: `value` is serialized with JSON.stringify, so object values depend on
 * key order. Keep signed values to strings, numbers and booleans.
 */
export function canonicalizeEnvelope(
  env: Omit<ProvenanceEnvelope, "signature">
): string {
  return JSON.stringify({
    value: env.value,
    provenance: env.provenance,
    allowedReaders: [...env.allowedReaders].sort(),
    signerRole: env.signerRole,
    timestamp: env.timestamp,
    parentHashes: [...env.parentHashes].sort(),
  });
}

/** SHA-256 over the canonical content plus its signature. */
export function hashEnvelope(env: ProvenanceEnvelope): string {
  return crypto
    .createHash("sha256")
    .update(`${canonicalizeEnvelope(env)}:${env.signature}`)
    .digest("hex");
}

/** Readers allowed by both lists. "*" means "anyone". */
export function intersectReaders(a: string[], b: string[]): string[] {
  if (a.includes("*")) return [...b];
  if (b.includes("*")) return [...a];
  return a.filter((reader) => b.includes(reader));
}

export class CaMeLProvenanceAuthority {
  private role: AllowedRole;
  private privateKey: string;

  constructor(role: AllowedRole, privateKey: string) {
    this.role = role;
    this.privateKey = privateKey;
  }

  public mintEnvelope<T>(params: {
    value: T;
    requestedProvenance: CaMeLProvenanceLevel;
    allowedReaders: string[];
    parents?: ProvenanceEnvelope[];
  }): ProvenanceEnvelope<T> {
    // Only the gateway that records a human's click may mint trusted values.
    if (
      params.requestedProvenance === "TRUSTED_SYSTEM_ENUM" &&
      this.role !== TRUSTED_SIGNER_ROLE
    ) {
      throw new Error(
        `Role ${this.role} is not authorized to mint TRUSTED_SYSTEM_ENUM envelopes.`
      );
    }

    const parents = params.parents ?? [];

    // A quarantined sub-agent reads untrusted data, so everything it produces
    // is untrusted no matter what it asks for.
    let provenance: CaMeLProvenanceLevel =
      this.role === "QUARANTINED_SUBAGENT"
        ? "UNTRUSTED_Q_LLM_EXTRACTED"
        : params.requestedProvenance;
    let allowedReaders = [...params.allowedReaders];

    for (const parent of parents) {
      if (TAINT_RANK[parent.provenance] > TAINT_RANK[provenance]) {
        provenance = parent.provenance;
      }
      allowedReaders = intersectReaders(allowedReaders, parent.allowedReaders);
    }

    const unsigned: Omit<ProvenanceEnvelope<T>, "signature"> = {
      value: params.value,
      provenance,
      allowedReaders,
      signerRole: this.role,
      timestamp: Date.now(),
      parentHashes: parents.map((parent) => hashEnvelope(parent)),
    };

    const signature = crypto
      .sign(
        null,
        Buffer.from(canonicalizeEnvelope(unsigned), "utf8"),
        crypto.createPrivateKey(this.privateKey)
      )
      .toString("hex");

    return { ...unsigned, signature };
  }
}

export interface EnvelopeCheck {
  valid: boolean;
  reason?: string;
}

export class CaMeLGatekeeperVerifier {
  private registry: PublicKeyRegistry;

  constructor(registry: PublicKeyRegistry) {
    this.registry = registry;
  }

  /** Checks an envelope and says why it failed. */
  public checkEnvelope(envelope: unknown): EnvelopeCheck {
    const parsed = ProvenanceEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return { valid: false, reason: "Not a well-formed provenance envelope." };
    }
    const env = parsed.data as ProvenanceEnvelope;

    // A signature only proves who signed. It does not prove the signer was
    // allowed to claim "trusted", so that is checked separately.
    if (
      env.provenance === "TRUSTED_SYSTEM_ENUM" &&
      env.signerRole !== TRUSTED_SIGNER_ROLE
    ) {
      return {
        valid: false,
        reason: `Role ${env.signerRole} may not sign TRUSTED_SYSTEM_ENUM envelopes.`,
      };
    }

    const publicKeyPem = this.registry[env.signerRole];
    if (!publicKeyPem) {
      return {
        valid: false,
        reason: `No public key registered for role ${env.signerRole}.`,
      };
    }

    try {
      const ok = crypto.verify(
        null,
        Buffer.from(canonicalizeEnvelope(env), "utf8"),
        crypto.createPublicKey(publicKeyPem),
        Buffer.from(env.signature, "hex")
      );
      return ok
        ? { valid: true }
        : { valid: false, reason: "Signature does not match the envelope contents." };
    } catch {
      return { valid: false, reason: "Signature could not be verified." };
    }
  }

  public verifyEnvelope(envelope: unknown): boolean {
    return this.checkEnvelope(envelope).valid;
  }
}
