import type {
  NdxBootstrapReport,
  SessionContextSummary,
  TokenUsage,
} from "./types.js";

export type RuntimeOp =
  | { type: "user_turn"; prompt: string; cwd?: string }
  | { type: "interrupt"; reason?: string };

export interface Submission {
  id: string;
  op: RuntimeOp;
}

export interface RuntimeEvent {
  id: string;
  msg: RuntimeEventMsg;
}

export type RuntimeEventMsg =
  | SessionConfiguredEvent
  | TurnStartedEvent
  | ItemStartedEvent
  | AgentMessageDeltaEvent
  | ToolCallDeltaEvent
  | ItemCompletedEvent
  | AgentMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenCountEvent
  | TurnCompleteEvent
  | TurnAbortedEvent
  | WarningEvent
  | ErrorEvent;

export interface SessionConfiguredEvent {
  type: "session_configured";
  sessionId: string;
  model: string;
  cwd: string;
  approvalPolicy: string;
  sandboxMode: string;
  sources: string[];
  bootstrap: NdxBootstrapReport;
  context: SessionContextSummary;
}

export interface TurnStartedEvent {
  type: "turn_started";
  sessionId: string;
  turnId: string;
  prompt: string;
  cwd: string;
}

export interface AgentMessageEvent {
  type: "agent_message";
  sessionId: string;
  turnId: string;
  text: string;
}

export interface ItemStartedEvent {
  type: "item_started";
  sessionId: string;
  turnId: string;
  itemId: string;
  itemType: "message" | "function_call" | "reasoning" | "other";
  callId?: string;
  name?: string;
}

export interface AgentMessageDeltaEvent {
  type: "agent_message_delta";
  sessionId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ToolCallDeltaEvent {
  type: "tool_call_delta";
  sessionId: string;
  turnId: string;
  itemId: string;
  callId?: string;
  delta: string;
}

export interface ItemCompletedEvent {
  type: "item_completed";
  sessionId: string;
  turnId: string;
  itemId: string;
  itemType: "message" | "function_call" | "reasoning" | "other";
  text?: string;
  callId?: string;
  name?: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  sessionId: string;
  turnId: string;
  callId?: string;
  name: string;
  arguments: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  sessionId: string;
  turnId: string;
  callId?: string;
  name?: string;
  output: string;
}

export interface TokenCountEvent {
  type: "token_count";
  sessionId: string;
  turnId: string;
  usage: TokenUsage;
}

export interface TurnCompleteEvent {
  type: "turn_complete";
  sessionId: string;
  turnId: string;
  finalText: string;
}

export interface TurnAbortedEvent {
  type: "turn_aborted";
  sessionId: string;
  turnId?: string;
  reason: string;
}

export interface WarningEvent {
  type: "warning";
  sessionId: string;
  turnId?: string;
  message: string;
}

export interface ErrorEvent {
  type: "error";
  sessionId: string;
  turnId?: string;
  message: string;
  code: ModelErrorCode | "runtime_error";
  recoverable: boolean;
}

export type ModelErrorCode =
  | "unauthorized"
  | "bad_request"
  | "rate_limited"
  | "server_error"
  | "connection_failed"
  | "unknown";

export interface ClassifiedModelError {
  code: ModelErrorCode;
  recoverable: boolean;
  message: string;
}
