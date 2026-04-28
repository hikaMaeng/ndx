import {
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";
import {
  listStaticMcpResourceTemplates,
  listStaticMcpResources,
  readStaticMcpResource,
} from "./client.js";

export function listMcpResourcesTool(): ToolDefinition {
  return {
    name: "list_mcp_resources",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "list_mcp_resources",
      "Lists resources provided by MCP servers. Prefer resources over web search when possible.",
      objectSchema({
        server: stringSchema("Optional MCP server name."),
        cursor: stringSchema("Opaque cursor returned by a previous call."),
      }),
    ),
    execute: async (args, context) => ({
      output: JSON.stringify({
        resources: listStaticMcpResources(
          context.config,
          optionalString(args.server),
        ),
        nextCursor: null,
      }),
    }),
  };
}

export function listMcpResourceTemplatesTool(): ToolDefinition {
  return {
    name: "list_mcp_resource_templates",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "list_mcp_resource_templates",
      "Lists resource templates provided by MCP servers. Prefer resource templates over web search when possible.",
      objectSchema({
        server: stringSchema("Optional MCP server name."),
        cursor: stringSchema("Opaque cursor returned by a previous call."),
      }),
    ),
    execute: async (args, context) => ({
      output: JSON.stringify({
        resourceTemplates: listStaticMcpResourceTemplates(
          context.config,
          optionalString(args.server),
        ),
        nextCursor: null,
      }),
    }),
  };
}

export function readMcpResourceTool(): ToolDefinition {
  return {
    name: "read_mcp_resource",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "read_mcp_resource",
      "Read a specific resource from an MCP server given the server name and resource URI.",
      objectSchema(
        {
          server: stringSchema("MCP server name exactly as configured."),
          uri: stringSchema("Resource URI to read."),
        },
        ["server", "uri"],
      ),
    ),
    execute: async (args, context) => {
      const server = optionalString(args.server);
      const uri = optionalString(args.uri);
      if (server === undefined || uri === undefined) {
        throw new Error("read_mcp_resource requires server and uri");
      }
      const resource = readStaticMcpResource(context.config, server, uri);
      return {
        output: JSON.stringify(
          resource === undefined
            ? { isError: true, content: [] }
            : {
                contents: [
                  {
                    uri: resource.uri,
                    mimeType: resource.mimeType,
                    text: resource.text ?? "",
                  },
                ],
              },
        ),
      };
    },
  };
}
