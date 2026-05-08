import { selectedSkillMessages } from "./skills.js";
import { artifactContextMessages } from "./artifacts.js";
import { buildInitialContext } from "./initial-context.js";
import type { ModelConversationItem } from "../../model/types.js";
import type { ModelResponse, NdxConfig } from "../../shared/types.js";
import type { AgentRunOptions } from "./types.js";

export interface AgentLoopState {
  input: ModelConversationItem[];
  finalText: string;
}

export function createInitialState(
  prompt: string,
  config: NdxConfig,
  cwd: string,
  history: ModelConversationItem[] = [],
): AgentLoopState {
  const initialContext = buildInitialContext(config, cwd);
  const artifactContext = artifactContextMessages(prompt, history, cwd);
  const skillMessages = selectedSkillMessages(prompt, config, cwd);
  return {
    input: [
      ...initialContext,
      ...artifactContext,
      ...skillMessages,
      { type: "message", role: "user", content: prompt },
    ],
    finalText: "",
  };
}

export function modelInput(
  state: AgentLoopState,
  history: ModelConversationItem[],
): ModelConversationItem[] {
  if (history.length === 0) {
    return state.input;
  }
  return [...history, ...state.input];
}

export function updateStateFromModelResponse(
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
    state.input.push({
      type: "message",
      role: "assistant",
      content: response.text,
    });
    if (response.toolCalls.length === 0) {
      state.finalText = response.text;
      options.onEvent?.({ type: "model_text", text: response.text });
    }
  }
  if (response.usage !== undefined) {
    options.onEvent?.({ type: "token_count", usage: response.usage });
  }
}
