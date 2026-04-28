import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import type { EnvMap, ShellResult } from "../../types.js";
import {
  booleanSchema,
  functionTool,
  integerSchema,
  objectSchema,
  optionalNumber,
  optionalString,
  stringSchema,
} from "../schema.js";
import type {
  ExecSessionResult,
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "../types.js";

export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface ExecCommandArgs {
  cmd: string;
  workdir?: string;
  shell?: string;
  login?: boolean;
  tty?: boolean;
  yield_time_ms?: number;
  max_output_tokens?: number;
}

interface WriteStdinArgs {
  session_id: number;
  chars?: string;
  yield_time_ms?: number;
  max_output_tokens?: number;
}

interface ExecSession {
  child: ChildProcessWithoutNullStreams;
  output: string;
  startedAt: number;
  exitCode: number | null | undefined;
}

const execSessions = new Map<number, ExecSession>();
let nextSessionId = 1;

export function shellTool(): ToolDefinition {
  return {
    name: "shell",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "shell",
      "Run a shell command in the local workspace and return stdout, stderr, and exit status.",
      objectSchema(
        {
          command: stringSchema(
            "Command line to run through the platform shell.",
          ),
          cwd: stringSchema(
            "Optional working directory. Defaults to the agent cwd.",
          ),
          timeoutMs: integerSchema("Optional timeout in milliseconds."),
        },
        ["command"],
      ),
    ),
    execute: async (args, context) => {
      const result = await runShell(parseShellArgs(args), {
        cwd: context.cwd,
        env: context.env,
        timeoutMs: context.timeoutMs,
      });
      return { output: JSON.stringify(result) };
    },
  };
}

export function shellCommandTool(): ToolDefinition {
  return {
    name: "shell_command",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "shell_command",
      "Runs a shell command and returns its output. Always set workdir when possible.",
      objectSchema(
        {
          command: stringSchema(
            "The shell script to execute in the user's default shell.",
          ),
          workdir: stringSchema(
            "The working directory to execute the command in.",
          ),
          timeout_ms: integerSchema(
            "The timeout for the command in milliseconds.",
          ),
          login: booleanSchema(
            "Whether to run the shell with login shell semantics. Defaults to true.",
          ),
        },
        ["command"],
      ),
    ),
    execute: async (args, context) => {
      const command = optionalString(args.command);
      if (command === undefined) {
        throw new Error("shell_command requires command");
      }
      const result = await runShell(
        {
          command,
          cwd: optionalString(args.workdir),
          timeoutMs: optionalNumber(args.timeout_ms),
        },
        { cwd: context.cwd, env: context.env, timeoutMs: context.timeoutMs },
      );
      return { output: JSON.stringify(result) };
    },
  };
}

export function execCommandTool(): ToolDefinition {
  return {
    name: "exec_command",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "exec_command",
      "Runs a command, returning output or a session ID for ongoing interaction.",
      objectSchema(
        {
          cmd: stringSchema("Shell command to execute."),
          workdir: stringSchema(
            "Optional working directory to run the command in; defaults to the turn cwd.",
          ),
          shell: stringSchema(
            "Shell binary to launch. Defaults to the user's default shell.",
          ),
          login: booleanSchema(
            "Whether to run the shell with -l/-i semantics. Defaults to true.",
          ),
          tty: booleanSchema(
            "Whether to allocate a TTY. The TypeScript runtime records the flag but uses pipes.",
          ),
          yield_time_ms: integerSchema(
            "How long to wait in milliseconds for output before yielding.",
          ),
          max_output_tokens: integerSchema(
            "Maximum number of tokens to return. Excess output is truncated.",
          ),
        },
        ["cmd"],
      ),
    ),
    execute: async (args, context) =>
      runExecCommand(parseExecArgs(args), context),
  };
}

export function writeStdinTool(): ToolDefinition {
  return {
    name: "write_stdin",
    supportsParallelToolCalls: false,
    schema: functionTool(
      "write_stdin",
      "Writes characters to an existing exec_command session and returns recent output.",
      objectSchema(
        {
          session_id: integerSchema(
            "Identifier of the running exec_command session.",
          ),
          chars: stringSchema("Bytes to write to stdin; may be empty to poll."),
          yield_time_ms: integerSchema(
            "How long to wait in milliseconds for output before yielding.",
          ),
          max_output_tokens: integerSchema(
            "Maximum number of tokens to return. Excess output is truncated.",
          ),
        },
        ["session_id"],
      ),
    ),
    execute: async (args) => runWriteStdin(parseWriteStdinArgs(args)),
  };
}

export async function runShell(
  args: ShellArgs,
  options: { cwd: string; env: EnvMap; timeoutMs: number },
): Promise<ShellResult> {
  const cwd = resolve(args.cwd ?? options.cwd);
  const timeoutMs = args.timeoutMs ?? options.timeoutMs;
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const shellArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", args.command]
      : ["-lc", args.command];

  return await new Promise<ShellResult>((resolveResult, reject) => {
    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
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
        command: args.command,
        cwd,
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function parseShellArgs(raw: Record<string, unknown>): ShellArgs {
  const command = optionalString(raw.command);
  if (command === undefined) {
    throw new Error("shell tool call requires a string command");
  }
  return {
    command,
    cwd: optionalString(raw.cwd),
    timeoutMs: optionalNumber(raw.timeoutMs),
  };
}

function parseExecArgs(raw: Record<string, unknown>): ExecCommandArgs {
  const cmd = optionalString(raw.cmd);
  if (cmd === undefined) {
    throw new Error("exec_command requires cmd");
  }
  return {
    cmd,
    workdir: optionalString(raw.workdir),
    shell: optionalString(raw.shell),
    login: typeof raw.login === "boolean" ? raw.login : undefined,
    tty: typeof raw.tty === "boolean" ? raw.tty : undefined,
    yield_time_ms: optionalNumber(raw.yield_time_ms),
    max_output_tokens: optionalNumber(raw.max_output_tokens),
  };
}

function parseWriteStdinArgs(raw: Record<string, unknown>): WriteStdinArgs {
  if (typeof raw.session_id !== "number") {
    throw new Error("write_stdin requires numeric session_id");
  }
  return {
    session_id: raw.session_id,
    chars: optionalString(raw.chars),
    yield_time_ms: optionalNumber(raw.yield_time_ms),
    max_output_tokens: optionalNumber(raw.max_output_tokens),
  };
}

async function runExecCommand(
  args: ExecCommandArgs,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const cwd = resolve(args.workdir ?? context.cwd);
  const shell =
    args.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
  const shellArgs =
    process.platform === "win32" && shell.toLowerCase().endsWith("cmd.exe")
      ? ["/d", "/s", "/c", args.cmd]
      : [args.login === false ? "-c" : "-lc", args.cmd];
  const startedAt = Date.now();
  const child = spawn(shell, shellArgs, {
    cwd,
    env: { ...process.env, ...context.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const session: ExecSession = {
    child,
    output: "",
    startedAt,
    exitCode: undefined,
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    session.output += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    session.output += chunk;
  });
  child.on("close", (exitCode) => {
    session.exitCode = exitCode;
  });

  await delay(args.yield_time_ms ?? 1000);
  if (session.exitCode === undefined) {
    const sessionId = nextSessionId;
    nextSessionId += 1;
    execSessions.set(sessionId, session);
    return {
      output: JSON.stringify(
        execSessionResult(session, args.max_output_tokens, sessionId),
      ),
    };
  }
  return {
    output: JSON.stringify(execSessionResult(session, args.max_output_tokens)),
  };
}

async function runWriteStdin(
  args: WriteStdinArgs,
): Promise<ToolExecutionResult> {
  const session = execSessions.get(args.session_id);
  if (session === undefined) {
    return {
      output: JSON.stringify({
        wall_time_seconds: 0,
        output: `session ${args.session_id} not found`,
      } satisfies ExecSessionResult),
    };
  }
  if (args.chars !== undefined) {
    session.child.stdin.write(args.chars);
  }
  await delay(args.yield_time_ms ?? 1000);
  if (session.exitCode !== undefined) {
    execSessions.delete(args.session_id);
    return {
      output: JSON.stringify(
        execSessionResult(session, args.max_output_tokens),
      ),
    };
  }
  return {
    output: JSON.stringify(
      execSessionResult(session, args.max_output_tokens, args.session_id),
    ),
  };
}

function execSessionResult(
  session: ExecSession,
  maxOutputTokens: number | undefined,
  sessionId?: number,
): ExecSessionResult {
  return {
    wall_time_seconds: (Date.now() - session.startedAt) / 1000,
    exit_code: session.exitCode,
    session_id: sessionId,
    original_token_count: Math.ceil(session.output.length / 4),
    output: truncateOutput(session.output, maxOutputTokens),
  };
}

function truncateOutput(
  output: string,
  maxOutputTokens: number | undefined,
): string {
  if (maxOutputTokens === undefined) {
    return output;
  }
  const maxChars = Math.max(0, Math.floor(maxOutputTokens * 4));
  return output.length <= maxChars
    ? output
    : `${output.slice(0, maxChars)}\n[truncated]`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, Math.max(0, ms)),
  );
}
