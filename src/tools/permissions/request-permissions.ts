import { functionTool, objectSchema, stringSchema } from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function requestPermissionsTool(): ToolDefinition {
  return {
    name: "request_permissions",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "request_permissions",
      "Request additional filesystem or network permissions from the user.",
      objectSchema(
        {
          reason: stringSchema(
            "Optional short explanation for why additional permissions are needed.",
          ),
          permissions: objectSchema({
            network: objectSchema({ enabled: { type: "boolean" } }),
            file_system: objectSchema({
              read: { type: "array", items: { type: "string" } },
              write: { type: "array", items: { type: "string" } },
            }),
          }),
        },
        ["permissions"],
      ),
    ),
    execute: async () => ({
      output: JSON.stringify({
        granted: false,
        message:
          "request_permissions is exposed for parity; this TypeScript CLI has no interactive approval client.",
      }),
    }),
  };
}
