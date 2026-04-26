import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type { EnvMap, LoadedConfig, NdxConfig } from "./types.js";

const DEFAULT_NDX_HOME = "/home/ndx/.ndx";
const CONFIG_DIR = ".ndx";
const CONFIG_FILE = "config.toml";

interface PartialConfig {
  model?: string;
  instructions?: string;
  maxTurns?: number;
  shellTimeoutMs?: number;
  env?: EnvMap;
}

export function resolveNdxHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.NDX_HOME || DEFAULT_NDX_HOME);
}

export function loadConfig(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  const sources: string[] = [];
  const merged: NdxConfig = {
    model: env.NDX_MODEL || "gpt-5",
    instructions:
      "You are ndx, a local coding agent. Prefer concise plans, inspect before editing, and use shell when facts must be verified.",
    env: {},
    maxTurns: 8,
    shellTimeoutMs: 120_000,
  };

  for (const file of configFiles(cwd, env)) {
    if (!existsSync(file)) {
      continue;
    }
    mergeConfig(merged, parseConfig(readFileSync(file, "utf8"), file));
    sources.push(file);
  }

  return { config: merged, sources };
}

export function configFiles(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const files = [join(resolveNdxHome(env), CONFIG_FILE)];
  const dirs = ancestorDirs(resolve(cwd)).reverse();
  for (const dir of dirs) {
    files.push(join(dir, CONFIG_DIR, CONFIG_FILE));
  }
  return files;
}

function mergeConfig(target: NdxConfig, source: PartialConfig): void {
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
  if (source.env !== undefined) {
    target.env = { ...target.env, ...source.env };
  }
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = resolve(start);
  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) {
      break;
    }
    current = parent;
  }
  return dirs;
}

function parseConfig(contents: string, file: string): PartialConfig {
  const parsed: PartialConfig = { env: {} };
  let table = "";
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }
    const tableMatch = /^\[([A-Za-z0-9_.-]+)]$/.exec(line);
    if (tableMatch) {
      table = tableMatch[1] ?? "";
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid config line in ${file}: ${rawLine}`);
    }
    const key = line.slice(0, eq).trim();
    const value = parseValue(line.slice(eq + 1).trim(), file);
    assign(parsed, table, key, value, file);
  }
  return parsed;
}

function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i - 1] !== "\\") {
      quoted = !quoted;
    }
    if (char === "#" && !quoted) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(raw: string, file: string): string | number | boolean {
  if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
    return JSON.parse(raw) as string;
  }
  if (/^(true|false)$/.test(raw)) {
    return raw === "true";
  }
  if (/^-?\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  throw new Error(`Unsupported config value in ${file}: ${raw}`);
}

function assign(
  parsed: PartialConfig,
  table: string,
  key: string,
  value: string | number | boolean,
  file: string,
): void {
  if (table === "env") {
    if (typeof value !== "string") {
      throw new Error(`[env].${key} in ${file} must be a string`);
    }
    parsed.env = { ...(parsed.env ?? {}), [key]: value };
    return;
  }

  if (table !== "") {
    return;
  }

  if (key === "model" || key === "instructions") {
    if (typeof value !== "string") {
      throw new Error(`${key} in ${file} must be a string`);
    }
    parsed[key] = value;
    return;
  }
  if (key === "max_turns") {
    if (typeof value !== "number") {
      throw new Error(`${key} in ${file} must be an integer`);
    }
    parsed.maxTurns = value;
    return;
  }
  if (key === "shell_timeout_ms") {
    if (typeof value !== "number") {
      throw new Error(`${key} in ${file} must be an integer`);
    }
    parsed.shellTimeoutMs = value;
  }
}
