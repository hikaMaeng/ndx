import {
  functionTool,
  integerSchema,
  objectSchema,
  optionalNumber,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function toolSearchTool(
  getTools: () => ToolDefinition[],
): ToolDefinition {
  return {
    name: "tool_search",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "tool_search",
      "Searches over deferred tool metadata and exposes matching tools from MCP and plugin sources.",
      objectSchema(
        {
          query: stringSchema("Search query for deferred tools."),
          limit: integerSchema(
            "Maximum number of tools to return; defaults to 8.",
          ),
        },
        ["query"],
      ),
    ),
    execute: async (args) => {
      const query = optionalString(args.query);
      if (query === undefined) {
        throw new Error("tool_search requires query");
      }
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const limit = optionalNumber(args.limit) ?? 8;
      const matches = getTools()
        .filter((tool) => tool.name !== "tool_search")
        .map((tool) => ({
          name: tool.name,
          description: tool.schema.function.description,
          score: scoreTool(tool, terms),
        }))
        .filter((tool) => tool.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.name.localeCompare(right.name),
        )
        .slice(0, limit);
      return { output: JSON.stringify({ tools: matches }) };
    },
  };
}

function scoreTool(tool: ToolDefinition, terms: string[]): number {
  const haystack =
    `${tool.name} ${tool.schema.function.description}`.toLowerCase();
  return terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}
