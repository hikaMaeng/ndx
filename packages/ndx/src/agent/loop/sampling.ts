import { throwIfAborted } from "../../runtime/abort.js";
import { executeToolCalls } from "./tool-execution.js";
import {
  modelInput,
  updateStateFromModelResponse,
  type AgentLoopState,
} from "./state.js";
import type { ModelResponse } from "../../shared/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { AgentRunOptions, SamplingResult } from "./types.js";

export async function runSamplingRequest(
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

function modelNeedsFollowUp(response: ModelResponse): boolean {
  return response.toolCalls.length > 0;
}
