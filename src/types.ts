export type EnvMap = Record<string, string>;
export type JsonObject = Record<string, unknown>;

export interface ProviderSettings {
  type: string;
  key: string;
  url: string;
}

export interface ModelSettings {
  name: string;
  provider: string;
  maxContext?: number;
}

export interface PermissionSettings {
  defaultMode: string;
}

export interface WebSearchSettings {
  provider?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface SearchRules {
  provider?: string;
  request?: JsonObject;
  response?: JsonObject;
  ranking?: JsonObject;
  [key: string]: unknown;
}

export interface NdxConfig {
  model: string;
  instructions: string;
  env: EnvMap;
  keys: EnvMap;
  maxTurns: number;
  shellTimeoutMs: number;
  providers: Record<string, ProviderSettings>;
  models: ModelSettings[];
  activeModel: ModelSettings;
  activeProvider: ProviderSettings;
  permissions: PermissionSettings;
  websearch: WebSearchSettings;
  search: SearchRules;
  mcp: JsonObject;
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
