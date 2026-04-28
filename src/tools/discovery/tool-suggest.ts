import { functionTool, objectSchema, stringSchema } from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function toolSuggestTool(): ToolDefinition {
  return {
    name: "tool_suggest",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "tool_suggest",
      "Suggests a missing connector or plugin when the user clearly wants a capability that is not currently available.",
      objectSchema(
        {
          tool_type: stringSchema("connector or plugin"),
          action_type: stringSchema("install or enable"),
          tool_id: stringSchema("Exact id from the discoverable tools list."),
          suggest_reason: stringSchema("Concise one-line reason."),
        },
        ["tool_type", "action_type", "tool_id", "suggest_reason"],
      ),
    ),
    execute: async (args) => ({
      output: JSON.stringify({
        accepted: false,
        suggestion: args,
        message:
          "tool_suggest is exposed for parity; this TypeScript CLI cannot install plugins interactively.",
      }),
    }),
  };
}
