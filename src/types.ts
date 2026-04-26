export type EnvMap = Record<string, string>;

export interface NdxConfig {
  model: string;
  instructions: string;
  env: EnvMap;
  maxTurns: number;
  shellTimeoutMs: number;
}

export interface LoadedConfig {
  config: NdxConfig;
  sources: string[];
}

export interface ShellResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ModelToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelResponse {
  id?: string;
  text: string;
  toolCalls: ModelToolCall[];
  raw: unknown;
}

export interface ModelClient {
  create(input: unknown, previousResponseId?: string): Promise<ModelResponse>;
}
