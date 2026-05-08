import { throwIfAborted } from "../../runtime/abort.js";
import { executeToolCalls } from "./tool-execution.js";
import {
  modelInput,
  updateStateFromModelResponse,
  type AgentLoopState,
} from "./state.js";
import type { ModelResponse, ModelStreamEvent } from "../../shared/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { AgentRunOptions, SamplingResult } from "./types.js";

export async function runSamplingRequest(
  state: AgentLoopState,
  registry: ToolRegistry,
  options: AgentRunOptions,
): Promise<SamplingResult> {
  throwIfAborted(options.signal);
  const input = modelInput(state, options.history ?? []);
  const response =
    options.client.stream === undefined
      ? await options.client.create(input, registry.schemas())
      : await collectStreamingResponse(
          options.client.stream(input, registry.schemas(), options.signal),
          options,
        );
  throwIfAborted(options.signal);
  updateStateFromModelResponse(state, response, options);
  if (!modelNeedsFollowUp(response)) {
    return { needsFollowUp: false };
  }
  const outputs = await executeToolCalls(
    response.toolCalls,
    registry,
    options,
    input,
  );
  state.input.push(...outputs);
  return {
    needsFollowUp: true,
    nextInput: state.input,
  };
}

function modelNeedsFollowUp(response: ModelResponse): boolean {
  return response.toolCalls.length > 0;
}

async function collectStreamingResponse(
  stream: AsyncIterable<ModelStreamEvent>,
  options: AgentRunOptions,
): Promise<ModelResponse> {
  let response: ModelResponse | undefined;
  for await (const event of stream) {
    throwIfAborted(options.signal);
    if (event.type === "item_started") {
      options.onEvent?.({
        type: "item_started",
        itemId: event.itemId,
        itemType: event.itemType,
        callId: event.callId,
        name: event.name,
      });
      continue;
    }
    if (event.type === "text_delta") {
      options.onEvent?.({
        type: "agent_message_delta",
        itemId: event.itemId,
        delta: event.delta,
      });
      continue;
    }
    if (event.type === "tool_call_delta") {
      options.onEvent?.({
        type: "tool_call_delta",
        itemId: event.itemId,
        callId: event.callId,
        delta: event.delta,
      });
      continue;
    }
    if (event.type === "item_completed") {
      options.onEvent?.({
        type: "item_completed",
        itemId: event.itemId,
        itemType: event.itemType,
        text: event.text,
        callId: event.callId,
        name: event.name,
      });
      continue;
    }
    if (event.type === "response_completed") {
      response = event.response;
    }
  }
  if (response === undefined) {
    throw new Error("model stream ended before response_completed");
  }
  return response;
}
