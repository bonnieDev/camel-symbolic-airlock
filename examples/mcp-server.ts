import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CaMeLMcpToolRegistry } from "../src/server/index";

/**
 * Wraps a guarded tool registry in a real MCP server.
 * A rejected call comes back as a normal MCP tool error (`isError: true`)
 * so the client can show the stop-and-ask screen instead of retrying.
 */
export function createGuardedMcpServer(registry: CaMeLMcpToolRegistry): Server {
  const server = new Server(
    { name: "camel-symbolic-airlock-demo", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () =>
    registry.getToolsListResponse()
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await registry.executeToolCall(
        request.params.name,
        request.params.arguments ?? {}
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: (err as Error).message }],
      };
    }
  });

  return server;
}
