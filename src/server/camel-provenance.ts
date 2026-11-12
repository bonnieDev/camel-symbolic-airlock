import crypto from "node:crypto";
import { CaMeLProvenanceLevel, ProvenanceEnvelope } from "../index";

export type AllowedRole =
  | "UI_AIRLOCK_GATEWAY"
  | "ORCHESTRATOR_AGENT"
  | "QUARANTINED_SUBAGENT"
  | "TOOL_EXECUTOR";

export interface PublicKeyRegistry {
  [role: string]: string; // PEM public keys
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
    // Enforce role-to-provenance security invariant
    if (params.requestedProvenance === "TRUSTED_SYSTEM_ENUM" && this.role !== "UI_AIRLOCK_GATEWAY") {
      throw new Error(`Role ${this.role} is not authorized to mint TRUSTED_SYSTEM_ENUM envelopes.`);
    }

    const parentHashes = params.parents ? params.parents.map(p => this.hashEnvelope(p)) : [];
    
    // Taint merger (Highest Watermark law)
    let finalProvenance = params.requestedProvenance;
    let finalReaders = [...params.allowedReaders];

    if (params.parents && params.parents.length > 0) {
      for (const parent of params.parents) {
        if (parent.provenance === "UNTRUSTED_Q_LLM_EXTRACTED") {
          finalProvenance = "UNTRUSTED_Q_LLM_EXTRACTED";
        }
        // Intersect allowed readers
        finalReaders = finalReaders.filter(r => r === "*" || parent.allowedReaders.includes(r) || parent.allowedReaders.includes("*"));
      }
    }

    const payload = {
      value: params.value,
      provenance: finalProvenance,
      allowedReaders: finalReaders,
      signerRole: this.role,
      timestamp: Date.now(),
      parentHashes,
    };

    const canonicalString = JSON.stringify(payload);
    const signature = crypto.sign(null, Buffer.from(canonicalString), crypto.createPrivateKey(this.privateKey)).toString("hex");

    return {
      ...payload,
      signature,
    };
  }

  private hashEnvelope(env: ProvenanceEnvelope): string {
    const copy = { ...env, signature: "" };
    return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
  }
}

export class CaMeLGatekeeperVerifier {
  private registry: PublicKeyRegistry;

  constructor(registry: PublicKeyRegistry) {
    this.registry = registry;
  }

  public verifyEnvelope<T>(envelope: ProvenanceEnvelope<T>): boolean {
    const pubKeyPem = this.registry[envelope.signerRole];
    if (!pubKeyPem) return false;

    const copy = { ...envelope, signature: "" };
    const canonicalString = JSON.stringify(copy);

    try {
      return crypto.verify(
        null,
        Buffer.from(canonicalString),
        crypto.createPublicKey(pubKeyPem),
        Buffer.from(envelope.signature, "hex")
      );
    } catch {
      return false;
    }
  }
}
