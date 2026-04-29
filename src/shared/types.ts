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

export interface ToolRuntimeSettings {
  imageGeneration: boolean;
}

export interface NdxPaths {
  globalDir: string;
  projectDir?: string;
  projectNdxDir?: string;
}

export interface McpToolSettings {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  deferLoading?: boolean;
}

export interface McpResourceSettings {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  text?: string;
}

export interface McpResourceTemplateSettings {
  uriTemplate: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerSettings {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: EnvMap;
  namespace?: string;
  description?: string;
  tools?: McpToolSettings[];
  resources?: McpResourceSettings[];
  resourceTemplates?: McpResourceTemplateSettings[];
}

export type McpSettings = Record<string, McpServerSettings>;

export interface PluginToolSettings {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  command?: string;
  args?: string[];
  cwd?: string;
  deferLoading?: boolean;
}

export interface PluginSettings {
  id: string;
  name?: string;
  description?: string;
  namespace?: string;
  tools?: PluginToolSettings[];
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
  mcp: McpSettings;
  globalMcp: McpSettings;
  projectMcp: McpSettings;
  plugins: PluginSettings[];
  tools: ToolRuntimeSettings;
  paths: NdxPaths;
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
  usage?: TokenUsage;
  raw: unknown;
}

export interface ModelClient {
  create(
    input: unknown,
    previousResponseId?: string,
    tools?: unknown[],
  ): Promise<ModelResponse>;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
