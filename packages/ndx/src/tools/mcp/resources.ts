import {
  arraySchema,
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";
import {
  listConfiguredMcpResourceTemplates,
  listConfiguredMcpResources,
  readConfiguredMcpResource,
} from "./client.js";

export function mcpResourceTools(): ToolDefinition[] {
  return [
    {
      name: "list_mcp_resources",
      supportsParallelToolCalls: false,
      schema: functionTool(
        "list_mcp_resources",
        "List known MCP resources from configured servers. Omit server to list all configured servers.",
        objectSchema({
          server: stringSchema("Optional MCP server name."),
        }),
      ),
      execute: async (args, context) => ({
        output: JSON.stringify({
          resources: await listConfiguredMcpResources(
            context.config,
            optionalString(args.server),
          ),
        }),
      }),
    },
    {
      name: "list_mcp_resource_templates",
      supportsParallelToolCalls: false,
      schema: functionTool(
        "list_mcp_resource_templates",
        "List known MCP resource templates from configured servers. Omit server to list all configured servers.",
        objectSchema({
          server: stringSchema("Optional MCP server name."),
        }),
      ),
      execute: async (args, context) => ({
        output: JSON.stringify({
          resourceTemplates: await listConfiguredMcpResourceTemplates(
            context.config,
            optionalString(args.server),
          ),
        }),
      }),
    },
    {
      name: "read_mcp_resource",
      supportsParallelToolCalls: false,
      schema: functionTool(
        "read_mcp_resource",
        "Read one MCP resource by server name and URI.",
        objectSchema(
          {
            server: stringSchema("MCP server name."),
            uri: stringSchema("Resource URI."),
          },
          ["server", "uri"],
        ),
      ),
      execute: async (args, context) => ({
        output: JSON.stringify({
          contents: await readConfiguredMcpResource(
            context.config,
            requiredString(args.server, "server"),
            requiredString(args.uri, "uri"),
          ),
        }),
      }),
    },
  ];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}
