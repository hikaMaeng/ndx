import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ToolContext, ToolExecutionResult } from "./types.js";

export async function executeToolInWorker(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
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
      const response = parseWorkerResponse(stdout);
      if (exitCode !== 0 || response?.error !== undefined) {
        reject(
          new Error(
            response?.error ||
              stderr.trim() ||
              `tool worker exited with code ${exitCode}`,
          ),
        );
        return;
      }
      resolve({ output: response?.output ?? "" });
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
