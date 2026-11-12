import { createDemoSystem, router } from "./demo-config";

/**
 * End-to-end walk-through. Run with: npm run demo
 *
 * It shows the two layers working together:
 *   1. a vague request is stopped and turned into choices
 *   2. only a human's signed choice is allowed to reach the tool
 */

function show(title: string, value: unknown) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

async function expectRejected(label: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
    console.log(`\n${label}\n  NOT rejected. This is a bug.`);
    process.exitCode = 1;
  } catch (err) {
    console.log(`\n${label}\n  Rejected: ${(err as Error).message}`);
  }
}

async function runDemo() {
  const { registry, signChoice, subagent, gateway } = createDemoSystem();

  console.log("=== Layer 1: the stop-and-ask step ===");

  const vague = router.route("Hey, go ahead and clean the staging logs.");
  show('1. "Hey, go ahead and clean the staging logs."', vague);

  const clear = router.route("Archive 25 of the staging logs.");
  show('2. "Archive 25 of the staging logs."', clear);

  const tooMany = router.route("Archive 5000 of the staging logs.");
  show('3. "Archive 5000 of the staging logs."', tooMany);

  console.log("\n=== Layer 2: only a signed human choice may run ===");

  // The person clicks "ARCHIVE_SOFT_DELETE" and sets the slider to 25.
  const signed = signChoice({ actionSymbol: "ARCHIVE_SOFT_DELETE", limit: 25 });
  const result = await registry.executeToolCall("run_maintenance", signed);
  show("4. Signed choice reaches the tool:", result);

  await expectRejected("5. Plain, unsigned arguments:", () =>
    registry.executeToolCall("run_maintenance", {
      actionSymbol: "ARCHIVE_SOFT_DELETE",
      maxRecords: 25,
    })
  );

  await expectRejected("6. A signed envelope edited after signing (25 changed to 50):", () =>
    registry.executeToolCall("run_maintenance", {
      ...signed,
      maxRecords: { ...signed.maxRecords, value: 50 },
    })
  );

  await expectRejected("7. A sub-agent's own envelope used as the action:", () =>
    registry.executeToolCall("run_maintenance", {
      ...signed,
      actionSymbol: subagent.mintEnvelope({
        value: "ARCHIVE_SOFT_DELETE",
        requestedProvenance: "UNTRUSTED_Q_LLM_EXTRACTED",
        allowedReaders: ["*"],
      }),
    })
  );

  await expectRejected("8. A sub-agent asking to mint a trusted envelope:", async () =>
    subagent.mintEnvelope({
      value: "ARCHIVE_SOFT_DELETE",
      requestedProvenance: "TRUSTED_SYSTEM_ENUM",
      allowedReaders: ["*"],
    })
  );

  await expectRejected("9. A validly signed action that is not on the tool's list:", () =>
    registry.executeToolCall("run_maintenance", {
      ...signed,
      actionSymbol: gateway.mintEnvelope({
        value: "DROP_EVERYTHING",
        requestedProvenance: "TRUSTED_SYSTEM_ENUM",
        allowedReaders: ["*"],
      }),
    })
  );

  console.log("\nDemo finished.");
}

runDemo().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
