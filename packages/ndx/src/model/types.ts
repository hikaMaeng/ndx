import type { ModelResponse } from "../shared/types.js";
import type { ModelToolCall } from "../shared/types.js";

export type ModelConversationItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "assistant_tool_calls"; toolCalls: ModelToolCall[] }
  | { type: "function_call_output"; call_id: string; output: string };

export type ModelInput = string | ModelConversationItem[] | unknown;

export interface ModelAdapter {
  create(input: ModelInput, tools?: unknown[]): Promise<ModelResponse>;
}

export interface ProviderRequestOptions {
  model: string;
  instructions: string;
  apiKey: string;
  baseUrl: string;
  effort?: string;
  think?: boolean;
  limitResponseLength?: number;
  temperature?: number;
  topK?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
  topP?: number;
  MinP?: number;
}
