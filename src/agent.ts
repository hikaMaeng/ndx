import { createToolRegistry } from "./tools/registry.js";
import { executeToolInWorker } from "./tools/process-runner.js";
import { unknownArgs } from "./tools/schema.js";
import type { ModelClient, NdxConfig, TokenUsage } from "./types.js";

export interface AgentRunOptions {
  cwd: string;
  config: NdxConfig;
  client: ModelClient;
  prompt: string;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "model_text"; text: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; output: string }
  | { type: "token_count"; usage: TokenUsage };

export async function runAgent(options: AgentRunOptions): Promise<string> {
  let input: unknown = options.prompt;
  let previousResponseId: string | undefined;
  let finalText = "";
  const registry = await createToolRegistry(options.config);

  for (let turn = 0; turn < options.config.maxTurns; turn += 1) {
    const response = await options.client.create(
      input,
      previousResponseId,
      registry.schemas(),
    );
    previousResponseId = response.id ?? previousResponseId;
    if (response.text) {
      finalText = response.text;
      options.onEvent?.({ type: "model_text", text: response.text });
    }
    if (response.usage !== undefined) {
      options.onEvent?.({ type: "token_count", usage: response.usage });
    }
    if (response.toolCalls.length === 0) {
      return finalText;
    }

    const outputs = await Promise.all(
      response.toolCalls.map((call) => executeToolCall(call, options)),
    );
    for (const output of outputs) {
      options.onEvent?.({ type: "tool_result", output: output.output });
    }
    input = outputs.map((output) => output.item);
  }

  throw new Error(`agent stopped after max_turns=${options.config.maxTurns}`);
}

async function executeToolCall(
  call: { callId: string; name: string; arguments: string },
  options: AgentRunOptions,
): Promise<{
  output: string;
  item: { type: "function_call_output"; call_id: string; output: string };
}> {
  options.onEvent?.({
    type: "tool_call",
    name: call.name,
    arguments: call.arguments,
  });
  const args = unknownArgs(call.arguments);
  const context = {
    cwd: options.cwd,
    config: options.config,
    env: options.config.env,
    timeoutMs: options.config.shellTimeoutMs,
  };
  const result = await executeToolInWorker(call.name, args, context);
  const output = result.output;
  return {
    output,
    item: {
      type: "function_call_output",
      call_id: call.callId,
      output,
    },
  };
}
