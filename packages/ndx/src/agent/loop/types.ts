import type { ModelClient, NdxConfig, TokenUsage } from "../../shared/types.js";
import type { ModelConversationItem } from "../../model/types.js";

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
  | {
      type: "item_started";
      itemId: string;
      itemType: "message" | "function_call" | "reasoning" | "other";
      callId?: string;
      name?: string;
    }
  | { type: "agent_message_delta"; itemId: string; delta: string }
  | { type: "tool_call_delta"; itemId: string; callId?: string; delta: string }
  | {
      type: "item_completed";
      itemId: string;
      itemType: "message" | "function_call" | "reasoning" | "other";
      text?: string;
      callId?: string;
      name?: string;
    }
  | { type: "model_text"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "token_count"; usage: TokenUsage }
  | { type: "warning"; message: string };

export type SamplingResult =
  | { needsFollowUp: false }
  | { needsFollowUp: true; nextInput: ModelConversationItem[] };
