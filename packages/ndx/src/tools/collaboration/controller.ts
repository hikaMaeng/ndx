import type { ModelConversationItem } from "../../model/types.js";
import type { ToolArguments, ToolContext } from "../types.js";

export type CollaborationAgentStatus =
  | "running"
  | "completed"
  | "failed"
  | "closed"
  | "queued"
  | "not_found";

export interface CollaborationAgentSnapshot {
  id: string;
  status: CollaborationAgentStatus;
  agentType?: string;
  prompt?: string;
  finalText?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  lastTaskMessage?: string;
}

export interface CollaborationAgentController {
  spawnAgent(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  sendInput(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  resumeAgent(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  waitAgent(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  closeAgent(
    args: ToolArguments,
    context: ToolContext,
  ): Promise<Record<string, unknown>>;
  listAgents(args: ToolArguments): Promise<Record<string, unknown>>;
  spawnAgentsOnCsv(
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  reportAgentJobResult(args: ToolArguments): Promise<Record<string, unknown>>;
}

export interface CollaborationChildRunOptions {
  cwd: string;
  prompt: string;
  history?: ModelConversationItem[];
  signal?: AbortSignal;
}
