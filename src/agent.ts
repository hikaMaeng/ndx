import { runShell, type ShellArgs } from "./tools/shell.js";
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

  for (let turn = 0; turn < options.config.maxTurns; turn += 1) {
    const response = await options.client.create(input, previousResponseId);
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
      if (call.name !== "shell") {
        outputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: `unsupported tool: ${call.name}`,
        });
        continue;
      }
      const args = parseShellArgs(call.arguments);
      const result = await runShell(args, {
        cwd: options.cwd,
        env: options.config.env,
        timeoutMs: options.config.shellTimeoutMs,
      });
      const output = JSON.stringify(result);
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

function parseShellArgs(raw: string): ShellArgs {
  const parsed = JSON.parse(raw) as Partial<ShellArgs>;
  if (!parsed.command || typeof parsed.command !== "string") {
    throw new Error("shell tool call requires a string command");
  }
  return {
    command: parsed.command,
    cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
    timeoutMs:
      typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
  };
}
