export type EnvMap = Record<string, string>;
export type JsonObject = Record<string, unknown>;

export type ProviderType = "openai" | "anthropic";

export interface ProviderSettings {
  type: ProviderType;
  key: string;
  url: string;
}

export interface ModelSettings {
  id?: string;
  name: string;
  provider: string;
  maxContext?: number;
  effort?: string[];
  activeEffort?: string;
  think?: boolean;
  activeThink?: boolean;
  limitResponseLength?: number;
  temperature?: number;
  topK?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
  topP?: number;
  MinP?: number;
}

export interface ModelPools {
  session: string[];
  worker: string[];
  reviewer: string[];
  custom: Record<string, string[]>;
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
  dockerSandboxImage?: string;
}

export interface NdxPaths {
  globalDir: string;
  dataDir?: string;
  sessionDir?: string;
  projectDir?: string;
  projectNdxDir?: string;
}

export type NdxBootstrapStatus = "installed" | "existing";

export interface NdxBootstrapElement {
  name: string;
  path: string;
  status: NdxBootstrapStatus;
}

export interface NdxBootstrapReport {
  globalDir: string;
  checkedAt: number;
  elements: NdxBootstrapElement[];
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
  modelPools: ModelPools;
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
  create(input: unknown, tools?: unknown[]): Promise<ModelResponse>;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
