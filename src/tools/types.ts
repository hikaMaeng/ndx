import type { EnvMap, JsonObject, NdxConfig, ShellResult } from "../types.js";

export type ToolArguments = Record<string, unknown>;

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

export interface ToolContext {
  cwd: string;
  config: NdxConfig;
  env: EnvMap;
  timeoutMs: number;
}

export interface ToolExecutionResult {
  output: string;
}

export interface ToolDefinition {
  name: string;
  schema: ToolSchema;
  supportsParallelToolCalls: boolean;
  execute(args: ToolArguments, context: ToolContext): Promise<ToolExecutionResult>;
}

export interface ExecSessionResult {
  chunk_id?: string;
  wall_time_seconds: number;
  exit_code?: number | null;
  session_id?: number;
  original_token_count?: number;
  output: string;
}

export type ShellLikeResult = ShellResult | ExecSessionResult;
