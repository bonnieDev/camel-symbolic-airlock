import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDemoSystem } from "../examples/demo-config";
import { createGuardedMcpServer } from "../examples/mcp-server";

async function connect() {
  const system = createDemoSystem();
  const server = createGuardedMcpServer(system.registry);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { ...system, client, server };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("Over a real MCP connection", () => {
  it("lists the guarded tool with its envelope schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "run_maintenance");
    assert.deepEqual(tools[0]?.inputSchema.required, ["actionSymbol", "maxRecords"]);
    await client.close();
  });

  it("runs the tool when the arguments are signed human choices", async () => {
    const { client, signChoice } = await connect();
    const result = await client.callTool({
      name: "run_maintenance",
      arguments: signChoice({ actionSymbol: "DEDUPLICATE_BY_HASH", limit: 10 }),
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(textOf(result)), {
      executed: "DEDUPLICATE_BY_HASH",
      maxRecords: 10,
    });
    await client.close();
  });

  it("returns a tool error for plain arguments", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "run_maintenance",
      arguments: { actionSymbol: "ARCHIVE_SOFT_DELETE", maxRecords: 25 },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /must be wrapped in a signed ProvenanceEnvelope/);
    await client.close();
  });
});
