import type {
  EnvMap,
  JsonObject,
  NdxConfig,
  ShellResult,
} from "../../shared/types.js";

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

export type ToolKind = "task" | "external";

export interface ExternalToolRuntime {
  name?: string;
  command: string;
  args: string[];
  cwd?: string;
  env: EnvMap;
  timeoutMs?: number;
  toolDir: string;
}

export interface ToolDefinition {
  name: string;
  schema: ToolSchema;
  kind?: ToolKind;
  layer?: string;
  runtime?: ExternalToolRuntime;
  supportsParallelToolCalls?: boolean;
  execute?: (
    args: ToolArguments,
    context: ToolContext,
    signal?: AbortSignal,
  ) => Promise<ToolExecutionResult>;
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
