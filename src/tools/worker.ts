import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { NdxConfig } from "../shared/types.js";
import { createToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

interface WorkerRequest {
  name: string;
  args: Record<string, unknown>;
  context: ToolContext;
}

async function main(): Promise<void> {
  const request = await readRequest();
  const registry = await createToolRegistry(
    request.context.config as NdxConfig,
  );
  const result = await registry.execute(
    request.name,
    request.args,
    request.context,
  );
  writeResponse({ output: result.output });
}

async function readRequest(): Promise<WorkerRequest> {
  const rl = createInterface({ input });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return JSON.parse(lines.join("\n")) as WorkerRequest;
}

function writeResponse(response: { output?: string; error?: string }): void {
  output.write(`${JSON.stringify(response)}\n`);
}

main().catch((error: unknown) => {
  writeResponse({
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
