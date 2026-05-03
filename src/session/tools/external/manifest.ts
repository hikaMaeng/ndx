import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { EnvMap, JsonObject } from "../../../shared/types.js";
import type {
  ExternalToolRuntime,
  ToolRequirements,
  ToolDefinition,
  ToolSchema,
} from "../types.js";

interface ToolJson {
  schema?: ToolSchema;
  type?: "function";
  function?: ToolSchema["function"];
  command?: string;
  args?: string[];
  cwd?: string;
  env?: EnvMap;
  timeoutMs?: number;
  requirements?: Partial<ToolRequirements>;
}

interface ToolJsonPlaywrightRequirements {
  browsers?: string[];
  withDeps?: boolean;
}

export function discoverToolDirectory(
  toolsDir: string,
  layer: string,
): ToolDefinition[] {
  if (!existsSync(toolsDir)) {
    return [];
  }
  return readdirSync(toolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      loadToolManifest(join(toolsDir, entry.name), entry.name, layer),
    );
}

export function loadToolManifest(
  toolDir: string,
  folderName: string,
  layer: string,
): ToolDefinition {
  const manifestPath = join(toolDir, "tool.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`${toolDir} must contain tool.json`);
  }
  const manifest = parseToolJson(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  const schema = normalizeSchema(manifest, manifestPath);
  const requirements = normalizeRequirements(manifest.requirements);
  if (schema.function.name !== folderName) {
    throw new Error(
      `${manifestPath} function.name must match folder name ${folderName}`,
    );
  }
  if (manifest.command === undefined || manifest.command.length === 0) {
    throw new Error(`${manifestPath} requires command`);
  }
  return {
    name: schema.function.name,
    kind: "external",
    layer,
    schema,
    runtime: {
      name: schema.function.name,
      command: manifest.command,
      args: manifest.args ?? [],
      cwd:
        manifest.cwd === undefined
          ? undefined
          : resolveRelative(toolDir, manifest.cwd),
      env: manifest.env ?? {},
      timeoutMs: manifest.timeoutMs,
      toolDir,
      manifestPath,
      requirements,
    },
    requirements,
  };
}

function parseToolJson(contents: string, file: string): ToolJson {
  const parsed = JSON.parse(contents) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  const manifest = parsed as ToolJson;
  if (manifest.args !== undefined && !stringArray(manifest.args)) {
    throw new Error(`${file} args must be an array of strings`);
  }
  if (manifest.env !== undefined && !envMap(manifest.env)) {
    throw new Error(`${file} env must be an object of strings`);
  }
  if (
    manifest.timeoutMs !== undefined &&
    (typeof manifest.timeoutMs !== "number" ||
      !Number.isInteger(manifest.timeoutMs) ||
      manifest.timeoutMs < 0)
  ) {
    throw new Error(`${file} timeoutMs must be a non-negative integer`);
  }
  assertOptionalRequirements(manifest.requirements, file);
  return manifest;
}

function normalizeSchema(manifest: ToolJson, file: string): ToolSchema {
  const schema = manifest.schema ?? {
    type: manifest.type,
    function: manifest.function,
  };
  if (schema.type !== "function" || !isObject(schema.function)) {
    throw new Error(`${file} must define an OpenAI function tool schema`);
  }
  if (
    typeof schema.function.name !== "string" ||
    schema.function.name.length === 0 ||
    typeof schema.function.description !== "string" ||
    !isObject(schema.function.parameters)
  ) {
    throw new Error(
      `${file} function must include name, description, and parameters`,
    );
  }
  return schema as ToolSchema;
}

function resolveRelative(toolDir: string, path: string): string {
  return isAbsolute(path)
    ? path
    : resolve(dirname(join(toolDir, "tool.json")), path);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function envMap(value: unknown): value is EnvMap {
  return (
    isObject(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function normalizeRequirements(
  requirements: Partial<ToolRequirements> | undefined,
): ToolRequirements {
  const playwright =
    requirements?.playwright === undefined
      ? undefined
      : {
          browsers: uniqueSorted(requirements.playwright.browsers ?? []),
          withDeps: requirements.playwright.withDeps ?? false,
        };
  return {
    apt: uniqueSorted(requirements?.apt),
    npmGlobal: uniqueSorted(requirements?.npmGlobal),
    pip: uniqueSorted(requirements?.pip),
    binaries: uniqueSorted(requirements?.binaries),
    ...(playwright === undefined ? {} : { playwright }),
  };
}

function uniqueSorted(value: string[] | undefined): string[] {
  return [...new Set(value ?? [])].sort();
}

function assertOptionalRequirements(value: unknown, file: string): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new Error(`${file} requirements must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!["apt", "npmGlobal", "pip", "binaries", "playwright"].includes(key)) {
      throw new Error(`${file} requirements.${key} is not supported`);
    }
  }
  for (const key of ["apt", "npmGlobal", "pip", "binaries"] as const) {
    if (value[key] !== undefined && !stringArray(value[key])) {
      throw new Error(
        `${file} requirements.${key} must be an array of strings`,
      );
    }
  }
  if (value.playwright !== undefined) {
    assertOptionalPlaywrightRequirements(value.playwright, file);
  }
}

function assertOptionalPlaywrightRequirements(
  value: unknown,
  file: string,
): void {
  if (!isObject(value)) {
    throw new Error(`${file} requirements.playwright must be an object`);
  }
  const playwright = value as ToolJsonPlaywrightRequirements;
  for (const key of Object.keys(value)) {
    if (!["browsers", "withDeps"].includes(key)) {
      throw new Error(
        `${file} requirements.playwright.${key} is not supported`,
      );
    }
  }
  if (playwright.browsers !== undefined && !stringArray(playwright.browsers)) {
    throw new Error(
      `${file} requirements.playwright.browsers must be an array of strings`,
    );
  }
  if (
    playwright.withDeps !== undefined &&
    typeof playwright.withDeps !== "boolean"
  ) {
    throw new Error(`${file} requirements.playwright.withDeps must be boolean`);
  }
}
