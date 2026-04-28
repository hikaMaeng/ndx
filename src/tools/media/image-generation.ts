import {
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function imageGenerationTool(): ToolDefinition {
  return {
    name: "image_generation",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "image_generation",
      "Placeholder for Rust Codex image_generation parity. This TypeScript runtime exposes the contract but does not have a built-in image backend.",
      objectSchema(
        {
          prompt: stringSchema("Image generation prompt."),
        },
        ["prompt"],
      ),
    ),
    execute: async (args) => ({
      output: JSON.stringify({
        isError: true,
        prompt: optionalString(args.prompt) ?? "",
        message:
          "image_generation requires a client-provided image backend; none is configured in this TypeScript runtime.",
      }),
    }),
  };
}
