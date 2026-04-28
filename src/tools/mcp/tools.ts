import type { JsonObject, NdxConfig } from "../../types.js";
import { functionTool } from "../schema.js";
import type { ToolDefinition } from "../types.js";
import { callMcpTool } from "./client.js";

export function mcpToolDefinitions(config: NdxConfig): ToolDefinition[] {
  return Object.entries(config.mcp).flatMap(([serverName, server]) => {
    const namespace = server.namespace ?? `mcp__${serverName}__`;
    return (server.tools ?? []).map((tool) => {
      const exposedName = `${namespace}${tool.name}`;
      return {
        name: exposedName,
        supportsParallelToolCalls: false,
        schema: functionTool(
          exposedName,
          tool.description ?? `MCP tool ${tool.name} from ${serverName}.`,
          normalizeSchema(tool.inputSchema),
        ),
        execute: async (args, context) => ({
          output: JSON.stringify(
            await callMcpTool(context.config, serverName, tool.name, args),
          ),
        }),
      } satisfies ToolDefinition;
    });
  });
}

function normalizeSchema(schema: JsonObject | undefined): JsonObject {
  if (schema === undefined) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  return {
    ...schema,
    type: schema.type ?? "object",
    properties:
      typeof schema.properties === "object" && schema.properties !== null
        ? schema.properties
        : {},
  };
}
