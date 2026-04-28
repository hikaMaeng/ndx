import {
  arraySchema,
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function webSearchTool(): ToolDefinition {
  return {
    name: "web_search",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "web_search",
      "Search the web through the configured websearch provider. Tavily-compatible settings are supported.",
      objectSchema(
        {
          query: stringSchema("Search query."),
          allowed_domains: arraySchema(
            stringSchema(),
            "Optional domains to restrict results to.",
          ),
        },
        ["query"],
      ),
    ),
    execute: async (args, context) => {
      const query = optionalString(args.query);
      if (query === undefined) {
        throw new Error("web_search requires query");
      }
      const apiKey = optionalString(context.config.websearch.apiKey);
      if (apiKey === undefined || apiKey.length === 0) {
        return {
          output: JSON.stringify({
            isError: true,
            message: "web_search is configured but websearch.apiKey is empty",
          }),
        };
      }
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          include_answer: true,
          include_raw_content: false,
          max_results: 5,
          include_domains: Array.isArray(args.allowed_domains)
            ? args.allowed_domains
            : undefined,
        }),
      });
      return { output: JSON.stringify(await response.json()) };
    },
  };
}
