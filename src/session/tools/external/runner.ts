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
  signal?: AbortSignal,
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
      NDX_GLOBAL_DIR: context.config.paths.globalDir,
      NDX_CORE_TOOLS_DIR: resolve(
        context.config.paths.globalDir,
        "system",
        "tools",
      ),
      NDX_SYSTEM_TOOLS_DIR: resolve(
        context.config.paths.globalDir,
        "system",
        "tools",
      ),
      NDX_GLOBAL_TOOLS_DIR: resolve(context.config.paths.globalDir, "tools"),
      NDX_GLOBAL_PLUGINS_DIR: resolve(
        context.config.paths.globalDir,
        "plugins",
      ),
      NDX_PROJECT_TOOLS_DIR:
        context.config.paths.projectNdxDir === undefined
          ? ""
          : resolve(context.config.paths.projectNdxDir, "tools"),
      NDX_PROJECT_PLUGINS_DIR:
        context.config.paths.projectNdxDir === undefined
          ? ""
          : resolve(context.config.paths.projectNdxDir, "plugins"),
      NDX_WEBSEARCH_API_KEY: String(context.config.websearch.apiKey ?? ""),
      NDX_WEBSEARCH_PROVIDER: String(context.config.websearch.provider ?? ""),
    },
    input: `${JSON.stringify({
      arguments: args,
      cwd: context.cwd,
    })}\n`,
    timeoutMs,
    signal,
  });
  return {
    output: JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
    }),
  };
}
