import { createToolRegistry } from "./tools/registry.js";
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
  const registry = createToolRegistry(options.config);

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

    const outputs = [];
    for (const call of response.toolCalls) {
      options.onEvent?.({
        type: "tool_call",
        name: call.name,
        arguments: call.arguments,
      });
      const result = await registry.execute(
        call.name,
        unknownArgs(call.arguments),
        {
          cwd: options.cwd,
          config: options.config,
          env: options.config.env,
          timeoutMs: options.config.shellTimeoutMs,
        },
      );
      const output = result.output;
      options.onEvent?.({ type: "tool_result", output });
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output,
      });
    }
    input = outputs;
  }

  throw new Error(`agent stopped after max_turns=${options.config.maxTurns}`);
}
