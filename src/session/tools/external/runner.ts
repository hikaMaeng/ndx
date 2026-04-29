import { spawn } from "node:child_process";
import { resolve } from "node:path";
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
  return await new Promise<ToolExecutionResult>((resolveResult, reject) => {
    const child = spawn(runtime.command, runtime.args, {
      cwd: resolve(cwd),
      env: {
        ...process.env,
        ...context.env,
        ...runtime.env,
        NDX_TOOL_ARGS: JSON.stringify(args),
        NDX_TOOL_CWD: context.cwd,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveResult({
        output: JSON.stringify({
          exitCode,
          stdout,
          stderr,
          timedOut,
        }),
      });
    });
    child.stdin.end(
      `${JSON.stringify({
        arguments: args,
        cwd: context.cwd,
      })}\n`,
    );
  });
}
