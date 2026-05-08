import { throwIfAborted } from "../../runtime/abort.js";
import { executeToolInWorker } from "../../tools/process-runner.js";
import { unknownArgs } from "../../tools/schema.js";
import type { ModelConversationItem } from "../../model/types.js";
import type { ModelToolCall } from "../../shared/types.js";
import type { AgentRunOptions } from "./types.js";

type ToolOutput = {
  name: string;
  output: string;
  item: Extract<ModelConversationItem, { type: "function_call_output" }>;
};

export async function executeToolCalls(
  calls: ModelToolCall[],
  options: AgentRunOptions,
): Promise<ModelConversationItem[]> {
  throwIfAborted(options.signal);
  const outputs = await Promise.all(
    calls.map((call) => executeToolCall(call, options)),
  );
  throwIfAborted(options.signal);
  for (const output of outputs) {
    options.onEvent?.({
      type: "tool_result",
      callId: output.item.call_id,
      name: output.name,
      output: output.output,
    });
  }
  return outputs.map((output) => output.item);
}

async function executeToolCall(
  call: ModelToolCall,
  options: AgentRunOptions,
): Promise<ToolOutput> {
  options.onEvent?.({
    type: "tool_call",
    callId: call.callId,
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
  const result = await executeToolInWorker(
    call.name,
    args,
    context,
    options.signal,
  );
  const output = result.output;
  return {
    name: call.name,
    output,
    item: {
      type: "function_call_output",
      call_id: call.callId,
      output,
    },
  };
}
