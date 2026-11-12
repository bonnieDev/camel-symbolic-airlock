// src/index.ts
export type CaMeLProvenanceLevel =
  | "TRUSTED_SYSTEM_ENUM"
  | "UNTRUSTED_Q_LLM_EXTRACTED"
  | "INTERNAL_DERIVED_TRANSFORM";

export interface ProvenanceEnvelope<T = unknown> {
  value: T;
  provenance: CaMeLProvenanceLevel;
  allowedReaders: string[];
  signature: string;
  signerRole: string;
  timestamp: number;
  parentHashes: string[];
}
