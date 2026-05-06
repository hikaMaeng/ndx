import {
  arraySchema,
  functionTool,
  objectSchema,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function requestUserInputTool(): ToolDefinition {
  return {
    name: "request_user_input",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "request_user_input",
      "Unavailable in this non-interactive TypeScript runtime. Do not call this tool; make a conservative assumption or ask in the final response when input is strictly required.",
      objectSchema(
        {
          questions: arraySchema(
            objectSchema({
              id: stringSchema("Stable identifier for mapping answers."),
              header: stringSchema("Short header label."),
              question: stringSchema(
                "Single-sentence prompt shown to the user.",
              ),
              options: arraySchema(
                objectSchema({
                  label: stringSchema("User-facing label."),
                  description: stringSchema("Impact if selected."),
                }),
              ),
            }),
            "Questions to show the user.",
          ),
        },
        ["questions"],
      ),
    ),
    execute: async () => ({
      output: JSON.stringify({
        status: "unavailable",
        message:
          "request_user_input is unavailable in this non-interactive TypeScript runtime.",
      }),
    }),
  };
}
