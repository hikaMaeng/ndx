import type {
  ModelClient,
  NdxConfig,
  TokenUsage,
} from "../../shared/types.js";
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
  | { type: "model_text"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "token_count"; usage: TokenUsage }
  | { type: "warning"; message: string };

export type SamplingResult =
  | { needsFollowUp: false }
  | { needsFollowUp: true; nextInput: ModelConversationItem[] };
