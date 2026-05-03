import { resolve } from "node:path";
import { runProcess } from "../../../process/index.js";
import { mapHostPathToSandboxPath } from "../../sandbox-paths.js";
import type {
  ExternalToolRuntime,
  ToolContext,
  ToolExecutionResult,
} from "../types.js";

const TOOL_AUDIT_LOG = "/home/.ndx/system/logs/tool-executions.jsonl";

export async function runExternalTool(
  runtime: ExternalToolRuntime,
  args: Record<string, unknown>,
  context: ToolContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const timeoutMs = runtime.timeoutMs ?? context.timeoutMs;
  const cwd = resolve(runtime.cwd ?? runtime.toolDir);
  const sandbox = context.env.NDX_SANDBOX_CONTAINER;
  const toolCwd =
    sandbox === undefined || sandbox.length === 0
      ? cwd
      : mapHostPathToSandbox(context, cwd);
  const requestCwd =
    sandbox === undefined || sandbox.length === 0
      ? context.cwd
      : mapHostPathToSandbox(context, context.cwd);
  const env =
    sandbox === undefined || sandbox.length === 0
      ? hostToolEnv(runtime, context, args)
      : sandboxToolEnv(runtime, context, args, requestCwd);
  const command =
    sandbox === undefined || sandbox.length === 0
      ? runtime.command
      : sandboxCommand(runtime.command);
  const commandArgs =
    sandbox === undefined || sandbox.length === 0
      ? runtime.args
      : [
          "exec",
          "-i",
          "-w",
          toolCwd,
          ...Object.entries(env).flatMap(([key, value]) => [
            "-e",
            `${key}=${value}`,
          ]),
          sandbox,
          command,
          ...runtime.args.map((arg) => mapHostPathToSandbox(context, arg)),
        ];
  const audit = {
    tool: runtime.name ?? runtime.toolDir.split(/[\\/]/).at(-1) ?? command,
    command,
    commandArgs: auditCommandArgs(commandArgs),
    arguments: args,
    toolCwd,
    requestCwd,
    hostToolCwd: cwd,
    hostWorkspace: context.cwd,
    timeoutMs,
  };
  if (sandbox !== undefined && sandbox.length > 0) {
    await writeSandboxToolAudit(sandbox, {
      phase: "start",
      ...audit,
      envKeys: Object.keys(env).sort(),
    });
  }
  const result = await runProcess({
    command: sandbox === undefined || sandbox.length === 0 ? command : "docker",
    args: commandArgs,
    cwd,
    env:
      sandbox === undefined || sandbox.length === 0
        ? { ...process.env, ...env }
        : process.env,
    input: `${JSON.stringify({
      arguments: args,
      cwd: requestCwd,
    })}\n`,
    timeoutMs,
    signal,
  });
  if (sandbox !== undefined && sandbox.length > 0) {
    await writeSandboxToolAudit(sandbox, {
      phase: "finish",
      ...audit,
      dockerExecPid: result.pid,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
    });
  }
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

function hostToolEnv(
  runtime: ExternalToolRuntime,
  context: ToolContext,
  args: Record<string, unknown>,
): Record<string, string> {
  return {
    ...context.env,
    ...runtime.env,
    NDX_TOOL_NAME: runtime.name ?? "",
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
    NDX_GLOBAL_PLUGINS_DIR: resolve(context.config.paths.globalDir, "plugins"),
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
  };
}

function sandboxToolEnv(
  runtime: ExternalToolRuntime,
  context: ToolContext,
  args: Record<string, unknown>,
  requestCwd: string,
): Record<string, string> {
  const hostEnv = hostToolEnv(runtime, context, args);
  return {
    ...hostEnv,
    NDX_TOOL_EXECUTION_ENV: "container",
    NDX_TOOL_CWD: requestCwd,
    NDX_GLOBAL_DIR: "/home/.ndx",
    NDX_TOOL_AUDIT_LOG: TOOL_AUDIT_LOG,
    NDX_CORE_TOOLS_DIR: "/home/.ndx/system/tools",
    NDX_SYSTEM_TOOLS_DIR: "/home/.ndx/system/tools",
    NDX_GLOBAL_TOOLS_DIR: "/home/.ndx/tools",
    NDX_GLOBAL_PLUGINS_DIR: "/home/.ndx/plugins",
    NDX_SANDBOX_HOST_GLOBAL: context.config.paths.globalDir,
    NDX_PROJECT_TOOLS_DIR:
      context.config.paths.projectNdxDir === undefined
        ? ""
        : `${mapHostPathToSandbox(context, context.config.paths.projectNdxDir)}/tools`,
    NDX_PROJECT_PLUGINS_DIR:
      context.config.paths.projectNdxDir === undefined
        ? ""
        : `${mapHostPathToSandbox(context, context.config.paths.projectNdxDir)}/plugins`,
    NDX_SANDBOX_CONTAINER: "",
  };
}

function sandboxCommand(command: string): string {
  return command === process.execPath ? "node" : command;
}

function auditCommandArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    if (args[index - 1] !== "-e") {
      return arg;
    }
    const [key] = arg.split("=", 1);
    return `${key}=<redacted>`;
  });
}

async function writeSandboxToolAudit(
  container: string,
  event: Record<string, unknown>,
): Promise<void> {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  })}\n`;
  try {
    await runProcess({
      command: "docker",
      args: [
        "exec",
        "-i",
        container,
        "/bin/bash",
        "-lc",
        `mkdir -p /home/.ndx/system/logs && tee -a ${TOOL_AUDIT_LOG} > /proc/1/fd/1`,
      ],
      input: line,
      timeoutMs: 5_000,
    });
  } catch {
    // Tool execution should not fail because the audit sink is unavailable.
  }
}

function mapHostPathToSandbox(context: ToolContext, value: string): string {
  return mapHostPathToSandboxPath(value, {
    hostWorkspace: context.env.NDX_SANDBOX_HOST_WORKSPACE,
    sandboxWorkspace: context.env.NDX_SANDBOX_WORKSPACE,
    sandboxCwd: context.env.NDX_SANDBOX_CWD,
    hostGlobal: context.config.paths.globalDir,
    sandboxGlobal: "/home/.ndx",
  });
}
