import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type {
  EnvMap,
  JsonObject,
  LoadedConfig,
  ModelSettings,
  NdxConfig,
  PermissionSettings,
  ProviderSettings,
  SearchRules,
  WebSearchSettings,
} from "./types.js";

const DEFAULT_GLOBAL_NDX_DIR = "/home/.ndx";
const CONFIG_DIR = ".ndx";
const SETTINGS_FILE = "settings.json";
const SEARCH_FILE = "search.json";

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
  mcp?: JsonObject;
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

  for (const file of configFiles(cwd, options)) {
    if (!existsSync(file)) {
      continue;
    }
    mergeSettings(merged, parseSettings(readFileSync(file, "utf8"), file));
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

  return { config: finalizeConfig(merged), sources };
}

/** Return the global search rule file path. */
export function searchRulesFile(options: ConfigLoadOptions = {}): string {
  return join(resolveGlobalNdxDir(options), SEARCH_FILE);
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
    keys: {},
    env: {},
  };
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

function finalizeConfig(settings: PartialSettings): NdxConfig {
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
  };
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
