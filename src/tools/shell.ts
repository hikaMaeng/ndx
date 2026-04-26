import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { EnvMap, ShellResult } from "../types.js";

export interface ShellArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export function shellToolSchema(): Record<string, unknown> {
  return {
    type: "function",
    name: "shell",
    description:
      "Run a shell command in the local workspace and return stdout, stderr, and exit status.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: {
          type: "string",
          description: "Command line to run through the platform shell.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory. Defaults to the agent cwd.",
        },
        timeoutMs: {
          type: "integer",
          description: "Optional timeout in milliseconds.",
        },
      },
      required: ["command"],
    },
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
