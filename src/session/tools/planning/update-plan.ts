import {
  arraySchema,
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function updatePlanTool(): ToolDefinition {
  return {
    name: "update_plan",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "update_plan",
      "Updates the task plan. Provide an optional explanation and a list of plan items. At most one step can be in_progress at a time.",
      objectSchema(
        {
          explanation: stringSchema(),
          plan: arraySchema(
            objectSchema(
              {
                step: stringSchema(),
                status: stringSchema("One of: pending, in_progress, completed"),
              },
              ["step", "status"],
            ),
            "The list of steps",
          ),
        },
        ["plan"],
      ),
    ),
    execute: async (args) => {
      if (!Array.isArray(args.plan)) {
        throw new Error("update_plan requires plan");
      }
      return {
        output: JSON.stringify({
          explanation: optionalString(args.explanation) ?? null,
          plan: args.plan,
        }),
      };
    },
  };
}
