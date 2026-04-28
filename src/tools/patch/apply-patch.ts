import { spawn } from "node:child_process";
import {
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition, ToolExecutionResult } from "../types.js";

export function applyPatchTool(): ToolDefinition {
  return {
    name: "apply_patch",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "apply_patch",
      "Use the apply_patch tool to edit files. The TypeScript runtime accepts the patch in the input field.",
      objectSchema(
        {
          input: stringSchema(
            "The entire contents of the apply_patch command.",
          ),
        },
        ["input"],
      ),
    ),
    execute: async (args, context) =>
      runApplyPatch(optionalString(args.input), context.cwd),
  };
}

async function runApplyPatch(
  input: string | undefined,
  cwd: string,
): Promise<ToolExecutionResult> {
  if (input === undefined) {
    throw new Error("apply_patch requires input");
  }
  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    const child = spawn("apply_patch", [], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => {
      resolve({
        output: JSON.stringify({
          exitCode,
          stdout,
          stderr,
        }),
      });
    });
    child.stdin.end(input);
  });
}
