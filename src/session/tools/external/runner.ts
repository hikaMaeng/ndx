import { resolve } from "node:path";
import { runProcess } from "../../../process/index.js";
import type {
  ExternalToolRuntime,
  ToolContext,
  ToolExecutionResult,
} from "../types.js";

export async function runExternalTool(
  runtime: ExternalToolRuntime,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const timeoutMs = runtime.timeoutMs ?? context.timeoutMs;
  const cwd = runtime.cwd ?? runtime.toolDir;
  const result = await runProcess({
    command: runtime.command,
    args: runtime.args,
    cwd: resolve(cwd),
    env: {
      ...process.env,
      ...context.env,
      ...runtime.env,
      NDX_TOOL_ARGS: JSON.stringify(args),
      NDX_TOOL_CWD: context.cwd,
    },
    input: `${JSON.stringify({
      arguments: args,
      cwd: context.cwd,
    })}\n`,
    timeoutMs,
  });
  return {
    output: JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    }),
  };
}
