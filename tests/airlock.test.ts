import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import {
  canonicalizeEnvelope,
  createSymbolicRouter,
  intersectReaders,
} from "../src/server/index";
import { createDemoSystem, router } from "../examples/demo-config";

describe("Layer 1: stop-and-ask router", () => {
  it("halts on a vague verb and offers what it could mean", () => {
    const result = router.route("Hey, go ahead and clean the staging logs.");
    assert.equal(result.status, "HALT_AMBIGUOUS_SYMBOL");
    if (result.status !== "HALT_AMBIGUOUS_SYMBOL") return;
    assert.equal(result.detectedAmbiguity, "clean");
    assert.deepEqual(result.requiredEnums, [
      "ARCHIVE_SOFT_DELETE",
      "NORMALIZE_WHITESPACE",
      "DEDUPLICATE_BY_HASH",
    ]);
    assert.deepEqual(result.missing, ["ACTION", "LIMIT"]);
    assert.deepEqual(result.sliderBounds, { min: 1, max: 50 });
  });

  it("recognizes other forms of a vague verb", () => {
    for (const prompt of ["cleaning up staging", "Cleaned it?", "tidied the rows", "purging logs"]) {
      assert.equal(router.route(prompt).status, "HALT_AMBIGUOUS_SYMBOL", prompt);
    }
  });

  it("narrows the choices to what the verb could mean", () => {
    const result = router.route("fix the staging rows");
    assert.equal(result.status, "HALT_AMBIGUOUS_SYMBOL");
    if (result.status !== "HALT_AMBIGUOUS_SYMBOL") return;
    assert.deepEqual(result.requiredEnums, ["NORMALIZE_WHITESPACE", "DEDUPLICATE_BY_HASH"]);
  });

  it("passes a request that names one action and a valid limit", () => {
    assert.deepEqual(router.route("Archive 25 of the staging logs."), {
      status: "GROUNDED_READY",
      actionSymbol: "ARCHIVE_SOFT_DELETE",
      limit: 25,
    });
  });

  it("lets an exact action win over a vague verb in the same request", () => {
    const result = router.route("Clean up staging by archiving 10 old logs");
    assert.equal(result.status, "GROUNDED_READY");
  });

  it("halts when the limit is missing, out of range, or unclear", () => {
    for (const prompt of [
      "Archive the staging logs",
      "Archive 5000 staging logs",
      "Archive 10 logs from the last 30 days",
    ]) {
      const result = router.route(prompt);
      assert.equal(result.status, "HALT_AMBIGUOUS_SYMBOL", prompt);
      if (result.status !== "HALT_AMBIGUOUS_SYMBOL") continue;
      assert.deepEqual(result.missing, ["LIMIT"], prompt);
      assert.deepEqual(result.requiredEnums, ["ARCHIVE_SOFT_DELETE"], prompt);
    }
  });

  it("halts when two actions are named", () => {
    const result = router.route("archive and deduplicate 10 rows");
    assert.equal(result.status, "HALT_AMBIGUOUS_SYMBOL");
  });

  it("halts on anything it does not recognize", () => {
    const result = router.route("drop the whole database");
    assert.equal(result.status, "HALT_AMBIGUOUS_SYMBOL");
    if (result.status !== "HALT_AMBIGUOUS_SYMBOL") return;
    assert.equal(result.detectedAmbiguity, "no recognized action");
  });

  it("does not match a vague verb inside another word", () => {
    const result = router.route("archive 5 rows with the prefix fixture");
    assert.equal(result.status, "GROUNDED_READY");
  });

  it("validates a person's choice before it is signed", () => {
    assert.deepEqual(router.resolve({ actionSymbol: "DEDUPLICATE_BY_HASH", limit: 7 }), {
      status: "GROUNDED_READY",
      actionSymbol: "DEDUPLICATE_BY_HASH",
      limit: 7,
    });
    assert.throws(() => router.resolve({ actionSymbol: "DROP_EVERYTHING", limit: 7 }));
    assert.throws(() => router.resolve({ actionSymbol: "DEDUPLICATE_BY_HASH" }));
    assert.throws(() => router.resolve({ actionSymbol: "DEDUPLICATE_BY_HASH", limit: 51 }));
    assert.throws(() => router.resolve({ actionSymbol: "DEDUPLICATE_BY_HASH", limit: 2.5 }));
  });

  it("refuses a config whose vague verb points at an unknown action", () => {
    assert.throws(() =>
      createSymbolicRouter({
        actions: [{ symbol: "A", phrases: ["a"] }],
        ambiguousVerbs: { clean: ["B"] },
      })
    );
  });
});

describe("Layer 2: signed provenance envelopes", () => {
  it("accepts an envelope signed by the gateway", () => {
    const { gateway, verifier } = createDemoSystem();
    const env = gateway.mintEnvelope({
      value: "ARCHIVE_SOFT_DELETE",
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["*"],
    });
    assert.deepEqual(verifier.checkEnvelope(env), { valid: true });
  });

  it("rejects an envelope whose contents changed after signing", () => {
    const { gateway, verifier } = createDemoSystem();
    const env = gateway.mintEnvelope({
      value: 25,
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["*"],
    });
    assert.equal(verifier.verifyEnvelope({ ...env, value: 50 }), false);
    assert.equal(verifier.verifyEnvelope({ ...env, allowedReaders: ["attacker"] }), false);
  });

  it("stops a sub-agent from minting a trusted envelope", () => {
    const { subagent } = createDemoSystem();
    assert.throws(() =>
      subagent.mintEnvelope({
        value: "x",
        requestedProvenance: "TRUSTED_SYSTEM_ENUM",
        allowedReaders: ["*"],
      })
    );
  });

  it("rejects a hand-built 'trusted' envelope signed with a sub-agent key", () => {
    const { subagentKeys, verifier } = createDemoSystem();
    const unsigned = {
      value: "ARCHIVE_SOFT_DELETE",
      provenance: "TRUSTED_SYSTEM_ENUM" as const,
      allowedReaders: ["*"],
      signerRole: "QUARANTINED_SUBAGENT",
      timestamp: Date.now(),
      parentHashes: [],
    };
    const signature = crypto
      .sign(null, Buffer.from(canonicalizeEnvelope(unsigned), "utf8"), subagentKeys.privateKey)
      .toString("hex");
    const check = verifier.checkEnvelope({ ...unsigned, signature });
    assert.equal(check.valid, false);
    assert.match(check.reason ?? "", /may not sign TRUSTED_SYSTEM_ENUM/);
  });

  it("rejects malformed envelopes and unknown signers", () => {
    const { gateway, verifier } = createDemoSystem();
    const env = gateway.mintEnvelope({
      value: 1,
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["*"],
    });
    assert.equal(verifier.verifyEnvelope(null), false);
    assert.equal(verifier.verifyEnvelope({ value: 1 }), false);
    assert.equal(verifier.verifyEnvelope({ ...env, signerRole: "SOMEONE_ELSE" }), false);
    assert.equal(verifier.verifyEnvelope({ ...env, signature: "zz" }), false);
  });

  it("keeps taint: anything derived from untrusted data is untrusted", () => {
    const { gateway, subagent, verifier } = createDemoSystem();
    const trusted = gateway.mintEnvelope({
      value: "INTERNAL_DEV_TEAM",
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["INTERNAL_DEV_TEAM", "SECURITY_AUDIT_LOG"],
    });
    const scraped = subagent.mintEnvelope({
      value: "text from a web page",
      requestedProvenance: "INTERNAL_DERIVED_TRANSFORM",
      allowedReaders: ["*"],
    });
    assert.equal(scraped.provenance, "UNTRUSTED_Q_LLM_EXTRACTED");

    const merged = gateway.mintEnvelope({
      value: "summary",
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["*"],
      parents: [trusted, scraped],
    });
    assert.equal(merged.provenance, "UNTRUSTED_Q_LLM_EXTRACTED");
    assert.deepEqual(merged.allowedReaders, ["INTERNAL_DEV_TEAM", "SECURITY_AUDIT_LOG"]);
    assert.equal(merged.parentHashes.length, 2);
    assert.equal(verifier.verifyEnvelope(merged), true);
  });

  it("intersects reader lists, treating * as anyone", () => {
    assert.deepEqual(intersectReaders(["*"], ["A"]), ["A"]);
    assert.deepEqual(intersectReaders(["A", "B"], ["*"]), ["A", "B"]);
    assert.deepEqual(intersectReaders(["A", "B"], ["B", "C"]), ["B"]);
    assert.deepEqual(intersectReaders(["A"], ["C"]), []);
  });
});

describe("Both layers: guarded tool calls", () => {
  it("runs a tool only with a signed human choice", async () => {
    const { registry, signChoice } = createDemoSystem();
    const result = await registry.executeToolCall(
      "run_maintenance",
      signChoice({ actionSymbol: "ARCHIVE_SOFT_DELETE", limit: 25 })
    );
    assert.deepEqual(result, { executed: "ARCHIVE_SOFT_DELETE", maxRecords: 25 });
  });

  it("rejects unsigned, tampered, untrusted and off-list arguments", async () => {
    const { registry, signChoice, subagent, gateway } = createDemoSystem();
    const signed = signChoice({ actionSymbol: "ARCHIVE_SOFT_DELETE", limit: 25 });

    await assert.rejects(
      registry.executeToolCall("run_maintenance", {
        actionSymbol: "ARCHIVE_SOFT_DELETE",
        maxRecords: 25,
      }),
      /must be wrapped/
    );
    await assert.rejects(
      registry.executeToolCall("run_maintenance", {
        ...signed,
        maxRecords: { ...signed.maxRecords, value: 50 },
      }),
      /Signature does not match/
    );
    await assert.rejects(
      registry.executeToolCall("run_maintenance", {
        ...signed,
        actionSymbol: subagent.mintEnvelope({
          value: "ARCHIVE_SOFT_DELETE",
          requestedProvenance: "UNTRUSTED_Q_LLM_EXTRACTED",
          allowedReaders: ["*"],
        }),
      }),
      /requires TRUSTED_SYSTEM_ENUM/
    );
    await assert.rejects(
      registry.executeToolCall("run_maintenance", {
        ...signed,
        actionSymbol: gateway.mintEnvelope({
          value: "DROP_EVERYTHING",
          requestedProvenance: "TRUSTED_SYSTEM_ENUM",
          allowedReaders: ["*"],
        }),
      }),
      /does not allow/
    );
    await assert.rejects(registry.executeToolCall("no_such_tool", {}), /not found/);
  });

  it("describes guarded tools for an MCP tools/list response", () => {
    const { registry } = createDemoSystem();
    const { tools } = registry.getToolsListResponse();
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.equal(tool?.name, "run_maintenance");
    assert.deepEqual(tool?.inputSchema.required, ["actionSymbol", "maxRecords"]);
  });
});
