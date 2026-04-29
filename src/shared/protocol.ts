import type { NdxBootstrapReport, TokenUsage } from "./types.js";

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

export interface ToolCallEvent {
  type: "tool_call";
  sessionId: string;
  turnId: string;
  name: string;
  arguments: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  sessionId: string;
  turnId: string;
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
