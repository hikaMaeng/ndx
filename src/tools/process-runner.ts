import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentAbortError, abortReason, throwIfAborted } from "../abort.js";
import type { ToolContext, ToolExecutionResult } from "./types.js";

export async function executeToolInWorker(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  throwIfAborted(signal);
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const activeSignal = signal;
    const cleanup = (): void => {
      activeSignal?.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (result: ToolExecutionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = (): void => {
      if (activeSignal === undefined) {
        return;
      }
      child.kill("SIGTERM");
      rejectOnce(new AgentAbortError(abortReason(activeSignal)));
    };
    activeSignal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => rejectOnce(error));
    child.on("close", (exitCode) => {
      const response = parseWorkerResponse(stdout);
      if (exitCode !== 0 || response?.error !== undefined) {
        rejectOnce(
          new Error(
            response?.error ||
              stderr.trim() ||
              `tool worker exited with code ${exitCode}`,
          ),
        );
        return;
      }
      resolveOnce({ output: response?.output ?? "" });
    });
    child.stdin.end(JSON.stringify({ name, args, context }));
  });
}

function parseWorkerResponse(
  stdout: string,
): { output?: string; error?: string } | undefined {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  return line === undefined || line.length === 0
    ? undefined
    : (JSON.parse(line) as { output?: string; error?: string });
}
