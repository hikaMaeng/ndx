import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type {
  EnvMap,
  JsonObject,
  LoadedConfig,
  McpServerSettings,
  McpSettings,
  ModelSettings,
  NdxConfig,
  PermissionSettings,
  PluginSettings,
  ProviderSettings,
  SearchRules,
  ToolRuntimeSettings,
  WebSearchSettings,
} from "../shared/types.js";

const DEFAULT_GLOBAL_NDX_DIR = "/home/.ndx";
const CONFIG_DIR = ".ndx";
const SETTINGS_FILE = "settings.json";
const SEARCH_FILE = "search.json";
const CORE_SHELL_TOOL = `import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";

const request = JSON.parse(await readStdin());
const args = request.arguments ?? {};
const command = String(args.command ?? "");
const cwd = resolve(String(args.cwd ?? request.cwd ?? process.env.NDX_TOOL_CWD ?? process.cwd()));
const timeoutMs = Number.isInteger(args.timeoutMs) ? args.timeoutMs : 120000;
const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
const shellArgs =
  process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

const result = await new Promise((resolveResult, reject) => {
  const child = spawn(shell, shellArgs, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk) => {
    err += chunk;
  });
  child.on("error", reject);
  child.on("close", (exitCode) => {
    clearTimeout(timer);
    resolveResult({ command, cwd, exitCode, stdout: out, stderr: err, timedOut });
  });
});

stdout.write(\`\${JSON.stringify(result)}\\n\`);

function readStdin() {
  return new Promise((resolveRead) => {
    let body = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      body += chunk;
    });
    stdin.on("end", () => {
      resolveRead(body);
    });
  });
}`;

export interface ConfigLoadOptions {
  globalDir?: string;
}

interface PartialSettings {
  model?: string;
  instructions?: string;
  maxTurns?: number;
  shellTimeoutMs?: number;
  providers?: Record<string, ProviderSettings>;
  models?: ModelSettings[];
  permissions?: Partial<PermissionSettings>;
  websearch?: WebSearchSettings;
  search?: SearchRules;
  mcp?: McpSettings;
  plugins?: PluginSettings[];
  tools?: Partial<ToolRuntimeSettings>;
  keys?: EnvMap;
  env?: EnvMap;
}

/** Return the single global ndx configuration directory. */
export function resolveGlobalNdxDir(options: ConfigLoadOptions = {}): string {
  return resolve(options.globalDir ?? DEFAULT_GLOBAL_NDX_DIR);
}

/** Return settings files in strict global-then-project order. */
export function configFiles(
  cwd: string,
  options: ConfigLoadOptions = {},
): string[] {
  const files = [join(resolveGlobalNdxDir(options), SETTINGS_FILE)];
  const project = findProjectSettingsFile(cwd);
  if (project !== undefined && project !== files[0]) {
    files.push(project);
  }
  return files;
}

/** Load settings.json plus global search.json into the runtime config. */
export function loadConfig(
  cwd = process.cwd(),
  options: ConfigLoadOptions = {},
): LoadedConfig {
  const sources: string[] = [];
  const merged = defaultSettings();
  const globalDir = resolveGlobalNdxDir(options);
  ensureGlobalNdxHome(globalDir);
  let globalMcp: McpSettings = {};
  let projectMcp: McpSettings = {};
  let projectDir: string | undefined;

  for (const file of configFiles(cwd, options)) {
    if (!existsSync(file)) {
      continue;
    }
    const parsed = parseSettings(readFileSync(file, "utf8"), file);
    if (file === join(globalDir, SETTINGS_FILE)) {
      globalMcp = parsed.mcp ?? {};
    } else {
      projectMcp = parsed.mcp ?? {};
      projectDir = dirname(dirname(file));
    }
    mergeSettings(merged, parsed);
    sources.push(file);
  }

  const searchFile = searchRulesFile(options);
  if (existsSync(searchFile)) {
    merged.search = parseSearchRules(
      readFileSync(searchFile, "utf8"),
      searchFile,
    );
    sources.push(searchFile);
  }

  return {
    config: finalizeConfig(merged, {
      globalDir,
      projectDir,
      projectNdxDir:
        projectDir === undefined ? undefined : join(projectDir, CONFIG_DIR),
      globalMcp,
      projectMcp,
    }),
    sources,
  };
}

/** Return the global search rule file path. */
export function searchRulesFile(options: ConfigLoadOptions = {}): string {
  return join(resolveGlobalNdxDir(options), SEARCH_FILE);
}

/** Install required global .ndx files when they are missing. */
export function ensureGlobalNdxHome(globalDir: string): void {
  mkdirSync(globalDir, { recursive: true });
  const settingsFile = join(globalDir, SETTINGS_FILE);
  if (!existsSync(settingsFile)) {
    writeJsonFile(settingsFile, defaultSettings());
  }
  ensureCoreShellTool(globalDir);
}

function defaultSettings(): PartialSettings {
  return {
    model: "qwen3.6-35b-a3b:tr",
    instructions:
      "You are ndx, a local coding agent. Prefer concise plans, inspect before editing, and use shell when facts must be verified.",
    maxTurns: 8,
    shellTimeoutMs: 120_000,
    providers: {
      lmstudio: {
        type: "openai",
        key: "",
        url: "http://192.168.0.6:12345/v1",
      },
    },
    models: [
      {
        name: "qwen3.6-35b-a3b:tr",
        provider: "lmstudio",
        maxContext: 262_000,
      },
    ],
    permissions: { defaultMode: "danger-full-access" },
    websearch: { provider: "tavily", apiKey: "" },
    search: {},
    mcp: {},
    plugins: [],
    tools: { imageGeneration: false },
    keys: {},
    env: {},
  };
}

function ensureCoreShellTool(globalDir: string): void {
  const toolDir = join(globalDir, "core", "tools", "shell");
  const manifestFile = join(toolDir, "tool.json");
  const runtimeFile = join(toolDir, "tool.mjs");
  mkdirSync(toolDir, { recursive: true });
  if (!existsSync(manifestFile)) {
    writeJsonFile(manifestFile, {
      type: "function",
      function: {
        name: "shell",
        description:
          "Run a shell command in the local workspace and return stdout, stderr, and exit status.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            command: {
              type: "string",
              description: "Command line to run through the platform shell.",
            },
            cwd: {
              type: "string",
              description:
                "Optional working directory. Defaults to the agent cwd.",
            },
            timeoutMs: {
              type: "integer",
              description: "Optional timeout in milliseconds.",
            },
          },
          required: ["command"],
        },
      },
      command: "node",
      args: ["tool.mjs"],
    });
  }
  if (!existsSync(runtimeFile)) {
    writeFileSync(runtimeFile, `${CORE_SHELL_TOOL}\n`);
  }
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function findProjectSettingsFile(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, CONFIG_DIR, SETTINGS_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) {
      return undefined;
    }
    current = parent;
  }
}

function parseSettings(contents: string, file: string): PartialSettings {
  const parsed = parseJsonObject(contents, file) as PartialSettings;
  assertOptionalString(parsed.model, "model", file);
  assertOptionalString(parsed.instructions, "instructions", file);
  assertOptionalInteger(parsed.maxTurns, "maxTurns", file);
  assertOptionalInteger(parsed.shellTimeoutMs, "shellTimeoutMs", file);
  assertOptionalEnvMap(parsed.keys, "keys", file);
  assertOptionalEnvMap(parsed.env, "env", file);
  assertProviders(parsed.providers, file);
  assertModels(parsed.models, file);
  assertMcp(parsed.mcp, file);
  assertPlugins(parsed.plugins, file);
  assertTools(parsed.tools, file);
  return parsed;
}

function parseSearchRules(contents: string, file: string): SearchRules {
  return parseJsonObject(contents, file) as SearchRules;
}

function parseJsonObject(contents: string, file: string): JsonObject {
  const parsed = JSON.parse(contents) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return parsed;
}

function mergeSettings(target: PartialSettings, source: PartialSettings): void {
  if (source.model !== undefined) {
    target.model = source.model;
  }
  if (source.instructions !== undefined) {
    target.instructions = source.instructions;
  }
  if (source.maxTurns !== undefined) {
    target.maxTurns = source.maxTurns;
  }
  if (source.shellTimeoutMs !== undefined) {
    target.shellTimeoutMs = source.shellTimeoutMs;
  }
  if (source.providers !== undefined) {
    target.providers = { ...(target.providers ?? {}), ...source.providers };
  }
  if (source.models !== undefined) {
    target.models = mergeModels(target.models ?? [], source.models);
  }
  if (source.permissions !== undefined) {
    target.permissions = {
      ...(target.permissions ?? {}),
      ...source.permissions,
    };
  }
  if (source.websearch !== undefined) {
    target.websearch = { ...(target.websearch ?? {}), ...source.websearch };
  }
  if (source.search !== undefined) {
    target.search = { ...(target.search ?? {}), ...source.search };
  }
  if (source.mcp !== undefined) {
    target.mcp = { ...(target.mcp ?? {}), ...source.mcp };
  }
  if (source.plugins !== undefined) {
    target.plugins = [...(target.plugins ?? []), ...source.plugins];
  }
  if (source.tools !== undefined) {
    target.tools = { ...(target.tools ?? {}), ...source.tools };
  }
  if (source.keys !== undefined) {
    target.keys = { ...(target.keys ?? {}), ...source.keys };
  }
  if (source.env !== undefined) {
    target.env = { ...(target.env ?? {}), ...source.env };
  }
}

function mergeModels(
  existing: ModelSettings[],
  incoming: ModelSettings[],
): ModelSettings[] {
  const byName = new Map(existing.map((model) => [model.name, model]));
  for (const model of incoming) {
    byName.set(model.name, model);
  }
  return [...byName.values()];
}

function finalizeConfig(
  settings: PartialSettings,
  runtime: {
    globalDir: string;
    projectDir?: string;
    projectNdxDir?: string;
    globalMcp: McpSettings;
    projectMcp: McpSettings;
  },
): NdxConfig {
  const model = expectString(settings.model, "model");
  const providers = settings.providers ?? {};
  const models = settings.models ?? [];
  const activeModel = models.find((entry) => entry.name === model);
  if (activeModel === undefined) {
    throw new Error(`model ${model} is not declared in settings.json models`);
  }
  const activeProvider = providers[activeModel.provider];
  if (activeProvider === undefined) {
    throw new Error(
      `provider ${activeModel.provider} for model ${model} is not declared`,
    );
  }

  const keys = settings.keys ?? {};
  const env = { ...keys, ...(settings.env ?? {}) };
  return {
    model,
    instructions: expectString(settings.instructions, "instructions"),
    env,
    keys,
    maxTurns: expectNumber(settings.maxTurns, "maxTurns"),
    shellTimeoutMs: expectNumber(settings.shellTimeoutMs, "shellTimeoutMs"),
    providers,
    models,
    activeModel,
    activeProvider,
    permissions: {
      defaultMode: settings.permissions?.defaultMode ?? "danger-full-access",
    },
    websearch: settings.websearch ?? {},
    search: settings.search ?? {},
    mcp: settings.mcp ?? {},
    globalMcp: runtime.globalMcp,
    projectMcp: runtime.projectMcp,
    plugins: settings.plugins ?? [],
    tools: {
      imageGeneration: settings.tools?.imageGeneration ?? false,
    },
    paths: {
      globalDir: runtime.globalDir,
      projectDir: runtime.projectDir,
      projectNdxDir: runtime.projectNdxDir,
    },
  };
}

function assertMcp(mcp: McpSettings | undefined, file: string): void {
  if (mcp === undefined) {
    return;
  }
  if (!isObject(mcp)) {
    throw new Error(`mcp in ${file} must be an object`);
  }
  for (const [serverName, server] of Object.entries(mcp)) {
    if (!isObject(server)) {
      throw new Error(`mcp.${serverName} in ${file} must be an object`);
    }
    const settings = server as McpServerSettings;
    assertOptionalString(settings.command, `mcp.${serverName}.command`, file);
    assertOptionalString(settings.cwd, `mcp.${serverName}.cwd`, file);
    assertOptionalString(
      settings.namespace,
      `mcp.${serverName}.namespace`,
      file,
    );
    assertOptionalString(
      settings.description,
      `mcp.${serverName}.description`,
      file,
    );
    assertOptionalStringArray(settings.args, `mcp.${serverName}.args`, file);
    assertOptionalEnvMap(settings.env, `mcp.${serverName}.env`, file);
    assertOptionalArray(settings.tools, `mcp.${serverName}.tools`, file);
    assertOptionalArray(
      settings.resources,
      `mcp.${serverName}.resources`,
      file,
    );
    assertOptionalArray(
      settings.resourceTemplates,
      `mcp.${serverName}.resourceTemplates`,
      file,
    );
  }
}

function assertPlugins(
  plugins: PluginSettings[] | undefined,
  file: string,
): void {
  if (plugins === undefined) {
    return;
  }
  if (!Array.isArray(plugins)) {
    throw new Error(`plugins in ${file} must be an array`);
  }
  for (const [index, plugin] of plugins.entries()) {
    if (!isObject(plugin)) {
      throw new Error(`plugins[${index}] in ${file} must be an object`);
    }
    assertOptionalString(plugin.id, `plugins[${index}].id`, file);
    assertOptionalString(plugin.name, `plugins[${index}].name`, file);
    assertOptionalString(
      plugin.description,
      `plugins[${index}].description`,
      file,
    );
    assertOptionalString(plugin.namespace, `plugins[${index}].namespace`, file);
    assertOptionalArray(plugin.tools, `plugins[${index}].tools`, file);
  }
}

function assertTools(
  tools: Partial<ToolRuntimeSettings> | undefined,
  file: string,
): void {
  if (tools === undefined) {
    return;
  }
  if (!isObject(tools)) {
    throw new Error(`tools in ${file} must be an object`);
  }
  if (
    tools.imageGeneration !== undefined &&
    typeof tools.imageGeneration !== "boolean"
  ) {
    throw new Error(`tools.imageGeneration in ${file} must be a boolean`);
  }
}

function assertProviders(
  providers: Record<string, ProviderSettings> | undefined,
  file: string,
): void {
  if (providers === undefined) {
    return;
  }
  if (!isObject(providers)) {
    throw new Error(`providers in ${file} must be an object`);
  }
  for (const [name, provider] of Object.entries(providers)) {
    if (!isObject(provider)) {
      throw new Error(`providers.${name} in ${file} must be an object`);
    }
    assertOptionalString(provider.type, `providers.${name}.type`, file);
    assertOptionalString(provider.key, `providers.${name}.key`, file);
    assertOptionalString(provider.url, `providers.${name}.url`, file);
    if (
      provider.type !== undefined &&
      provider.type !== "openai" &&
      provider.type !== "anthropic"
    ) {
      throw new Error(
        `providers.${name}.type in ${file} must be openai or anthropic`,
      );
    }
  }
}

function assertModels(models: ModelSettings[] | undefined, file: string): void {
  if (models === undefined) {
    return;
  }
  if (!Array.isArray(models)) {
    throw new Error(`models in ${file} must be an array`);
  }
  for (const [index, model] of models.entries()) {
    if (!isObject(model)) {
      throw new Error(`models[${index}] in ${file} must be an object`);
    }
    assertOptionalString(model.name, `models[${index}].name`, file);
    assertOptionalString(model.provider, `models[${index}].provider`, file);
    assertOptionalInteger(
      model.maxContext,
      `models[${index}].maxContext`,
      file,
    );
  }
}

function assertOptionalString(
  value: unknown,
  field: string,
  file: string,
): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${field} in ${file} must be a string`);
  }
}

function assertOptionalInteger(
  value: unknown,
  field: string,
  file: string,
): void {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isInteger(value) || value < 0)
  ) {
    throw new Error(`${field} in ${file} must be a non-negative integer`);
  }
}

function assertOptionalStringArray(
  value: string[] | undefined,
  field: string,
  file: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} in ${file} must be an array of strings`);
  }
}

function assertOptionalArray(
  value: unknown[] | undefined,
  field: string,
  file: string,
): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${field} in ${file} must be an array`);
  }
}

function assertOptionalEnvMap(
  value: EnvMap | undefined,
  field: string,
  file: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new Error(`${field} in ${file} must be an object`);
  }
  for (const [key, envValue] of Object.entries(value)) {
    if (typeof envValue !== "string") {
      throw new Error(`${field}.${key} in ${file} must be a string`);
    }
  }
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`${field} must be a number`);
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
