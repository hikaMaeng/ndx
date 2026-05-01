import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import type {
  EnvMap,
  JsonObject,
  LoadedConfig,
  McpServerSettings,
  McpSettings,
  NdxBootstrapElement,
  NdxBootstrapReport,
  ModelPools,
  ModelSettings,
  NdxConfig,
  PermissionSettings,
  PluginSettings,
  ProviderSettings,
  SearchRules,
  ToolRuntimeSettings,
  WebSearchSettings,
} from "../shared/types.js";
import { CORE_TOOL_PACKAGES, type CoreToolPackage } from "./core-tools.js";

const DEFAULT_GLOBAL_NDX_DIR = join(homedir(), ".ndx");
const CONFIG_DIR = ".ndx";
const SETTINGS_FILE = "settings.json";
const SEARCH_FILE = "search.json";
const SYSTEM_DIR = "system";

export interface ConfigLoadOptions {
  globalDir?: string;
}

interface PartialSettings {
  model?: string | PartialModelPools;
  dataPath?: string;
  sessionPath?: string;
  instructions?: string;
  maxTurns?: number;
  shellTimeoutMs?: number;
  providers?: Record<string, ProviderSettings>;
  models?: ModelCatalogSettings;
  permissions?: Partial<PermissionSettings>;
  websearch?: WebSearchSettings;
  search?: SearchRules;
  mcp?: McpSettings;
  plugins?: PluginSettings[];
  tools?: Partial<ToolRuntimeSettings>;
  keys?: EnvMap;
  env?: EnvMap;
}

type ModelCatalogSettings =
  | ModelSettings[]
  | Record<string, Omit<ModelSettings, "id" | "name"> & { name?: string }>;

interface PartialModelPools {
  session?: string | string[];
  worker?: string | string[];
  reviewer?: string | string[];
  custom?: Record<string, string | string[]>;
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
  const merged = runtimeDefaults();
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

  if (sources.length === 0) {
    throw new Error(
      `missing ndx settings: expected ${configFiles(cwd, options).join(" or ")}`,
    );
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

/** Return the code-managed ndx system directory below the global home. */
export function systemDir(globalDir: string): string {
  return join(globalDir, SYSTEM_DIR);
}

/** Install required global .ndx directories and core tools when missing. */
export function ensureGlobalNdxHome(globalDir: string): NdxBootstrapReport {
  const elements: NdxBootstrapElement[] = [];
  const globalDirStatus = existsSync(globalDir) ? "existing" : "installed";
  mkdirSync(globalDir, { recursive: true });
  elements.push({
    name: "global directory",
    path: globalDir,
    status: globalDirStatus,
  });
  for (const directory of [
    SYSTEM_DIR,
    join(SYSTEM_DIR, "core"),
    join(SYSTEM_DIR, "core", "tools"),
    join(SYSTEM_DIR, "skills"),
  ]) {
    const path = join(globalDir, directory);
    const status = existsSync(path) ? "existing" : "installed";
    mkdirSync(path, { recursive: true });
    elements.push({
      name: directory,
      path,
      status,
    });
  }
  elements.push(...ensureCoreToolPackages(globalDir));
  return {
    globalDir,
    checkedAt: Date.now(),
    elements,
  };
}

function runtimeDefaults(): PartialSettings {
  return {
    instructions:
      "You are ndx, a local coding agent. Prefer concise plans, inspect before editing, and use shell when facts must be verified.",
    maxTurns: 8,
    shellTimeoutMs: 120_000,
    permissions: { defaultMode: "danger-full-access" },
    search: {},
    mcp: {},
    plugins: [],
    tools: { imageGeneration: false },
    keys: {},
    env: {},
  };
}

function ensureCoreToolPackages(globalDir: string): NdxBootstrapElement[] {
  return CORE_TOOL_PACKAGES.flatMap((tool) =>
    ensureCoreToolPackage(globalDir, tool),
  );
}

function ensureCoreToolPackage(
  globalDir: string,
  tool: CoreToolPackage,
): NdxBootstrapElement[] {
  const elements: NdxBootstrapElement[] = [];
  const toolDir = join(systemDir(globalDir), "core", "tools", tool.name);
  const manifestFile = join(toolDir, "tool.json");
  const runtimeFile = join(toolDir, "tool.mjs");
  const toolDirStatus = existsSync(toolDir) ? "existing" : "installed";
  mkdirSync(toolDir, { recursive: true });
  elements.push({
    name: `core ${tool.name} tool`,
    path: toolDir,
    status: toolDirStatus,
  });
  const manifestStatus = existsSync(manifestFile) ? "existing" : "installed";
  if (!existsSync(manifestFile)) {
    writeJsonFile(manifestFile, {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
      command: "node",
      args: ["tool.mjs"],
    });
  }
  elements.push({
    name: `core ${tool.name} manifest`,
    path: manifestFile,
    status: manifestStatus,
  });
  const runtimeStatus = existsSync(runtimeFile) ? "existing" : "installed";
  if (!existsSync(runtimeFile)) {
    writeFileSync(runtimeFile, `${tool.runtime}\n`);
  }
  elements.push({
    name: `core ${tool.name} runtime`,
    path: runtimeFile,
    status: runtimeStatus,
  });
  return elements;
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
  assertOptionalModelSelection(parsed.model, "model", file);
  assertOptionalString(parsed.dataPath, "dataPath", file);
  assertOptionalString(parsed.sessionPath, "sessionPath", file);
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
  if (source.sessionPath !== undefined) {
    target.sessionPath = source.sessionPath;
  }
  if (source.dataPath !== undefined) {
    target.dataPath = source.dataPath;
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
    target.models = mergeModels(
      normalizeModels(target.models ?? []),
      normalizeModels(source.models),
    );
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

export function configForModel(config: NdxConfig, model: string): NdxConfig {
  const activeModel = config.models.find((entry) => modelId(entry) === model);
  if (activeModel === undefined) {
    throw new Error(`model ${model} is not declared in settings.json models`);
  }
  const activeProvider = config.providers[activeModel.provider];
  if (activeProvider === undefined) {
    throw new Error(
      `provider ${activeModel.provider} for model ${model} is not declared`,
    );
  }
  return {
    ...config,
    model,
    activeModel,
    activeProvider,
  };
}

function mergeModels(
  existing: ModelSettings[],
  incoming: ModelSettings[],
): ModelSettings[] {
  const byName = new Map(existing.map((model) => [modelId(model), model]));
  for (const model of incoming) {
    byName.set(modelId(model), model);
  }
  return [...byName.values()];
}

function normalizeModels(models: ModelCatalogSettings): ModelSettings[] {
  if (Array.isArray(models)) {
    return models.map((model) => ({
      ...model,
      id: model.id ?? model.name,
      activeEffort: model.activeEffort ?? defaultModelEffort(model),
      activeThink: model.activeThink ?? defaultModelThink(model),
    }));
  }
  return Object.entries(models).map(([id, model]) => ({
    ...model,
    id,
    name: model.name ?? id,
    activeEffort: model.activeEffort ?? defaultModelEffort(model),
    activeThink: model.activeThink ?? defaultModelThink(model),
  }));
}

function modelId(model: ModelSettings): string {
  return model.id ?? model.name;
}

/** Return the default live effort for a model catalog entry. */
export function defaultModelEffort(
  model: Pick<ModelSettings, "effort">,
): string | undefined {
  if (model.effort === undefined || model.effort.length === 0) {
    return undefined;
  }
  return model.effort[Math.floor(model.effort.length / 2)];
}

/** Return the default live thinking mode for a model catalog entry. */
export function defaultModelThink(
  model: Pick<ModelSettings, "think">,
): boolean | undefined {
  return model.think === undefined ? undefined : true;
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
  const modelPools = expectModelPools(settings.model, "model");
  const model = modelPools.session[0];
  const providers = settings.providers ?? {};
  const models = normalizeModels(settings.models ?? []);
  validateModelPools(modelPools, models, providers);
  const activeModel = expectDeclaredModel(model, models);
  const activeProvider = expectDeclaredProvider(model, activeModel, providers);

  const keys = settings.keys ?? {};
  const env = { ...keys, ...(settings.env ?? {}) };
  const dataDir = resolve(
    settings.dataPath ?? settings.sessionPath ?? systemDir(runtime.globalDir),
  );
  return {
    model,
    modelPools,
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
      dataDir,
      sessionDir: dataDir,
      projectDir: runtime.projectDir,
      projectNdxDir: runtime.projectNdxDir,
    },
  };
}

function assertOptionalModelSelection(
  value: unknown,
  field: string,
  file: string,
): void {
  if (value === undefined || typeof value === "string") {
    return;
  }
  if (!isObject(value)) {
    throw new Error(
      `${field} in ${file} must be a string or model pool object`,
    );
  }
  for (const key of Object.keys(value)) {
    if (
      key !== "session" &&
      key !== "worker" &&
      key !== "reviewer" &&
      key !== "custom"
    ) {
      throw new Error(`${field}.${key} in ${file} is not supported`);
    }
  }
  assertModelPoolValue(value.session, `${field}.session`, file, true);
  assertModelPoolValue(value.worker, `${field}.worker`, file, false);
  assertModelPoolValue(value.reviewer, `${field}.reviewer`, file, false);
  assertCustomModelPools(value.custom, `${field}.custom`, file);
}

function assertModelPoolValue(
  value: unknown,
  field: string,
  file: string,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      throw new Error(`${field} in ${file} must be defined`);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0) {
    return;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    return;
  }
  throw new Error(
    `${field} in ${file} must be a string or non-empty array of strings`,
  );
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

function assertModels(
  models: ModelCatalogSettings | undefined,
  file: string,
): void {
  if (models === undefined) {
    return;
  }
  if (isObject(models)) {
    for (const [id, model] of Object.entries(models)) {
      if (!isObject(model)) {
        throw new Error(`models.${id} in ${file} must be an object`);
      }
      assertModelSettings(model, `models.${id}`, file, true);
    }
    return;
  }
  if (!Array.isArray(models)) {
    throw new Error(`models in ${file} must be an array or object`);
  }
  for (const [index, model] of models.entries()) {
    if (!isObject(model)) {
      throw new Error(`models[${index}] in ${file} must be an object`);
    }
    assertModelSettings(model, `models[${index}]`, file, false);
  }
}

function assertModelSettings(
  model: JsonObject,
  field: string,
  file: string,
  objectCatalog: boolean,
): void {
  assertOptionalString(model.name, `${field}.name`, file);
  if (!objectCatalog && typeof model.name !== "string") {
    throw new Error(`${field}.name in ${file} must be a string`);
  }
  assertOptionalString(model.provider, `${field}.provider`, file);
  assertOptionalInteger(model.maxContext, `${field}.maxContext`, file);
  assertOptionalStringArray(
    model.effort as string[] | undefined,
    `${field}.effort`,
    file,
  );
  assertOptionalBoolean(model.think, `${field}.think`, file);
  for (const key of [
    "limitResponseLength",
    "topK",
    "repeatPenalty",
    "presencePenalty",
    "topP",
    "MinP",
  ]) {
    assertOptionalNumber(model[key], `${field}.${key}`, file);
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

function assertOptionalNumber(
  value: unknown,
  field: string,
  file: string,
): void {
  if (value !== undefined && typeof value !== "number") {
    throw new Error(`${field} in ${file} must be a number`);
  }
}

function assertOptionalBoolean(
  value: unknown,
  field: string,
  file: string,
): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${field} in ${file} must be a boolean`);
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

function expectModelPools(value: unknown, field: string): ModelPools {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error(`${field} must not be empty`);
    }
    return { session: [value], worker: [], reviewer: [], custom: {} };
  }
  if (isObject(value)) {
    return {
      session: expectModelPoolValue(value.session, `${field}.session`, true),
      worker: expectModelPoolValue(value.worker, `${field}.worker`, false),
      reviewer: expectModelPoolValue(
        value.reviewer,
        `${field}.reviewer`,
        false,
      ),
      custom: expectCustomModelPools(value.custom, `${field}.custom`),
    };
  }
  throw new Error(`${field} must be a string or model pool object`);
}

function expectModelPoolValue(
  value: unknown,
  field: string,
  required: boolean,
): string[] {
  if (value === undefined) {
    if (required) {
      throw new Error(`${field} must be defined`);
    }
    return [];
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    return value;
  }
  throw new Error(`${field} must be a string or non-empty array of strings`);
}

function assertCustomModelPools(
  value: unknown,
  field: string,
  file: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new Error(`${field} in ${file} must be an object`);
  }
  for (const [name, pool] of Object.entries(value)) {
    if (name.length === 0 || /\s/.test(name) || name.includes("@")) {
      throw new Error(
        `${field}.${name} in ${file} must be a non-empty keyword without whitespace or @`,
      );
    }
    assertModelPoolValue(pool, `${field}.${name}`, file, true);
  }
}

function expectCustomModelPools(
  value: unknown,
  field: string,
): Record<string, string[]> {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    throw new Error(`${field} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, pool]) => [
      name,
      expectModelPoolValue(pool, `${field}.${name}`, true),
    ]),
  );
}

function validateModelPools(
  pools: ModelPools,
  models: ModelSettings[],
  providers: Record<string, ProviderSettings>,
): void {
  for (const model of [
    ...pools.session,
    ...pools.worker,
    ...pools.reviewer,
    ...Object.values(pools.custom).flat(),
  ]) {
    const activeModel = expectDeclaredModel(model, models);
    expectDeclaredProvider(model, activeModel, providers);
  }
}

function expectDeclaredModel(
  model: string,
  models: ModelSettings[],
): ModelSettings {
  const activeModel = models.find((entry) => modelId(entry) === model);
  if (activeModel === undefined) {
    throw new Error(`model ${model} is not declared in settings.json models`);
  }
  return activeModel;
}

function expectDeclaredProvider(
  model: string,
  activeModel: ModelSettings,
  providers: Record<string, ProviderSettings>,
): ProviderSettings {
  const activeProvider = providers[activeModel.provider];
  if (activeProvider === undefined) {
    throw new Error(
      `provider ${activeModel.provider} for model ${model} is not declared`,
    );
  }
  return activeProvider;
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
