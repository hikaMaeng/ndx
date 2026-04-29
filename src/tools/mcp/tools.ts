import type { JsonObject, McpSettings, NdxConfig } from "../../shared/types.js";
import { functionTool } from "../schema.js";
import type { ToolDefinition } from "../types.js";
import { callMcpTool, listMcpServerTools } from "./client.js";

export async function mcpToolDefinitions(
  config: NdxConfig,
  settings: McpSettings,
  layer: string,
): Promise<ToolDefinition[]> {
  const definitions: ToolDefinition[] = [];
  for (const [serverName, server] of Object.entries(settings)) {
    const namespace = server.namespace ?? `mcp__${serverName}__`;
    const declaredTools = [...(server.tools ?? [])];
    if (server.command !== undefined) {
      declaredTools.push(...(await listMcpServerTools(server)));
    }
    definitions.push(
      ...declaredTools.map((tool) => {
        const exposedName = `${namespace}${tool.name}`;
        return {
          name: exposedName,
          kind: "external",
          layer,
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
      }),
    );
  }
  return definitions;
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
