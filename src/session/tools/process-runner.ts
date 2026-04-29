import { fileURLToPath } from "node:url";
import { runProcess } from "../../process/index.js";
import {
  AgentAbortError,
  abortReason,
  throwIfAborted,
} from "../../runtime/abort.js";
import type { ToolContext, ToolExecutionResult } from "./types.js";

export async function executeToolInWorker(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  throwIfAborted(signal);
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
  const result = await runProcess({
    command: process.execPath,
    args: [workerPath],
    input: JSON.stringify({ name, args, context }),
    signal,
  });
  if (result.cancelled && signal !== undefined) {
    throw new AgentAbortError(abortReason(signal));
  }
  const response = parseWorkerResponse(result.stdout);
  if (result.exitCode !== 0 || response?.error !== undefined) {
    throw new Error(
      response?.error ||
        result.stderr.trim() ||
        `tool worker exited with code ${result.exitCode}`,
    );
  }
  return { output: response?.output ?? "" };
}

function parseWorkerResponse(
  stdout: string,
): { output?: string; error?: string } | undefined {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  return line === undefined || line.length === 0
    ? undefined
    : (JSON.parse(line) as { output?: string; error?: string });
}
