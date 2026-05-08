import { throwIfAborted } from "../../runtime/abort.js";
import { unknownArgs } from "../../tools/schema.js";
import type { ModelConversationItem } from "../../model/types.js";
import type { ModelToolCall } from "../../shared/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { AgentRunOptions } from "./types.js";

type ToolOutput = {
  name: string;
  output: string;
  item: Extract<ModelConversationItem, { type: "function_call_output" }>;
};

export async function executeToolCalls(
  calls: ModelToolCall[],
  registry: ToolRegistry,
  options: AgentRunOptions,
  historySnapshot: ModelConversationItem[],
): Promise<ModelConversationItem[]> {
  throwIfAborted(options.signal);
  const outputs = calls.every((call) =>
    registry.supportsParallelToolCalls(call.name),
  )
    ? await Promise.all(
        calls.map((call) =>
          executeToolCall(call, registry, options, historySnapshot),
        ),
      )
    : await executeToolCallsSequentially(
        calls,
        registry,
        options,
        historySnapshot,
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
  registry: ToolRegistry,
  options: AgentRunOptions,
  historySnapshot: ModelConversationItem[],
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
    historySnapshot,
    agentController: options.agentController,
  };
  const output = await executeRegistryTool(
    call,
    args,
    registry,
    options,
    context,
  );
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

async function executeToolCallsSequentially(
  calls: ModelToolCall[],
  registry: ToolRegistry,
  options: AgentRunOptions,
  historySnapshot: ModelConversationItem[],
): Promise<ToolOutput[]> {
  const outputs: ToolOutput[] = [];
  for (const call of calls) {
    outputs.push(
      await executeToolCall(call, registry, options, historySnapshot),
    );
  }
  return outputs;
}

async function executeRegistryTool(
  call: ModelToolCall,
  args: Record<string, unknown>,
  registry: ToolRegistry,
  options: AgentRunOptions,
  context: Parameters<ToolRegistry["execute"]>[2],
): Promise<string> {
  try {
    const result = await registry.execute(
      call.name,
      args,
      context,
      options.signal,
    );
    return result.output;
  } catch (error) {
    throwIfAborted(options.signal);
    return JSON.stringify({
      error: {
        tool: call.name,
        message: errorMessage(error),
      },
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
