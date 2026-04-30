import { throwIfAborted } from "../runtime/abort.js";
import { createToolRegistry } from "../session/tools/registry.js";
import { executeToolInWorker } from "../session/tools/process-runner.js";
import { unknownArgs } from "../session/tools/schema.js";
import type {
  ModelClient,
  ModelResponse,
  ModelToolCall,
  NdxConfig,
  TokenUsage,
} from "../shared/types.js";
import type { ModelConversationItem } from "../model/types.js";
import type { ToolRegistry } from "../session/tools/registry.js";

export interface AgentRunOptions {
  cwd: string;
  config: NdxConfig;
  client: ModelClient;
  prompt: string;
  history?: ModelConversationItem[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "model_text"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; output: string }
  | { type: "token_count"; usage: TokenUsage };

export async function runAgent(options: AgentRunOptions): Promise<string> {
  const state = createInitialState(options.prompt);
  const registry = await createToolRegistry(options.config);

  for (let turn = 0; turn < options.config.maxTurns; turn += 1) {
    const result = await runSamplingRequest(state, registry, options);
    if (!result.needsFollowUp) {
      return state.finalText;
    }
    state.input = result.nextInput;
  }

  throw new Error(`agent stopped after max_turns=${options.config.maxTurns}`);
}

interface AgentLoopState {
  input: ModelConversationItem[];
  finalText: string;
}

type SamplingResult =
  | { needsFollowUp: false }
  | { needsFollowUp: true; nextInput: ModelConversationItem[] };

function createInitialState(prompt: string): AgentLoopState {
  return {
    input: [{ type: "message", role: "user", content: prompt }],
    finalText: "",
  };
}

async function runSamplingRequest(
  state: AgentLoopState,
  registry: ToolRegistry,
  options: AgentRunOptions,
): Promise<SamplingResult> {
  throwIfAborted(options.signal);
  const input = modelInput(state, options.history ?? []);
  const response = await options.client.create(input, registry.schemas());
  throwIfAborted(options.signal);
  updateStateFromModelResponse(state, response, options);
  if (!modelNeedsFollowUp(response)) {
    return { needsFollowUp: false };
  }
  const outputs = await executeToolCalls(response.toolCalls, options);
  state.input.push(...outputs);
  return {
    needsFollowUp: true,
    nextInput: state.input,
  };
}

function modelInput(
  state: AgentLoopState,
  history: ModelConversationItem[],
): ModelConversationItem[] {
  if (history.length === 0) {
    return state.input;
  }
  return [...history, ...state.input];
}

function updateStateFromModelResponse(
  state: AgentLoopState,
  response: ModelResponse,
  options: AgentRunOptions,
): void {
  if (response.toolCalls.length > 0) {
    state.input.push({
      type: "assistant_tool_calls",
      toolCalls: response.toolCalls,
    });
  }
  if (response.text) {
    state.finalText = response.text;
    state.input.push({
      type: "message",
      role: "assistant",
      content: response.text,
    });
    options.onEvent?.({ type: "model_text", text: response.text });
  }
  if (response.usage !== undefined) {
    options.onEvent?.({ type: "token_count", usage: response.usage });
  }
}

function modelNeedsFollowUp(response: ModelResponse): boolean {
  return response.toolCalls.length > 0;
}

async function executeToolCalls(
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
      output: output.output,
    });
  }
  return outputs.map((output) => output.item);
}

async function executeToolCall(
  call: ModelToolCall,
  options: AgentRunOptions,
): Promise<{
  output: string;
  item: { type: "function_call_output"; call_id: string; output: string };
}> {
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
    output,
    item: {
      type: "function_call_output",
      call_id: call.callId,
      output,
    },
  };
}
