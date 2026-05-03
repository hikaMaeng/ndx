import type { JsonObject } from "../shared/types.js";

export interface CoreToolPackage {
  name: string;
  description: string;
  parameters: JsonObject;
  runtime: string;
}

const READ_STDIN = String.raw`
async function readRequest() {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    body += chunk;
  }
  return JSON.parse(body || "{}");
}
`;

export const CORE_TOOL_PACKAGES: CoreToolPackage[] = [
  {
    name: "shell",
    description:
      "Run a shell command in the local workspace and return stdout, stderr, and exit status.",
    parameters: objectSchema(
      {
        command: stringSchema(
          "Command line to run through the platform shell.",
        ),
        cwd: stringSchema(
          "Optional working directory. Defaults to the agent cwd.",
        ),
        timeoutMs: integerSchema("Optional timeout in milliseconds."),
      },
      ["command"],
    ),
    runtime: String.raw`import { spawn } from "node:child_process";
import { resolve } from "node:path";
${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
const command = String(args.command ?? "");
const cwd = resolve(toSandboxPath(String(args.cwd ?? request.cwd ?? process.env.NDX_TOOL_CWD ?? process.cwd())));
const timeoutMs = Number.isInteger(args.timeoutMs) ? args.timeoutMs : 120000;
const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
const sandbox = process.env.NDX_SANDBOX_CONTAINER ?? "";
const sandboxCwd = toSandboxPath(cwd);
const commandExec = sandbox.length > 0 ? "docker" : shell;
const commandArgs = sandbox.length > 0
  ? ["exec", "-w", sandboxCwd, sandbox, "/bin/bash", "-lc", command]
  : shellArgs;
const result = await new Promise((resolveResult, reject) => {
  const child = spawn(commandExec, commandArgs, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (exitCode) => {
    clearTimeout(timer);
    resolveResult({ command, cwd: sandbox.length > 0 ? sandboxCwd : cwd, pid: child.pid, exitCode, stdout, stderr, timedOut });
  });
});
process.stdout.write(JSON.stringify(result) + "\n");
function toSandboxPath(path) {
  const hostRoot = process.env.NDX_SANDBOX_HOST_WORKSPACE ?? "";
  const sandboxRoot = process.env.NDX_SANDBOX_WORKSPACE ?? "/workspace";
  const sandboxCwd = process.env.NDX_SANDBOX_CWD ?? process.env.NDX_TOOL_CWD ?? sandboxRoot;
  const hostGlobal = process.env.NDX_SANDBOX_HOST_GLOBAL ?? "";
  return mapPath(path, [
    [hostRoot, sandboxRoot],
    [hostGlobal, "/home/.ndx"],
  ], sandboxCwd);
}
function mapPath(path, mappings, fallback) {
  if (path.length === 0) return fallback;
  const absolute = isAbsolutePath(path);
  const normalized = absolute ? normalizePath(path) : path;
  if (normalized === "/root" || normalized.startsWith("/root/")) {
    return fallback + normalized.slice("/root".length);
  }
  for (const root of [fallback, "/workspace", "/home/.ndx"]) {
    if (root && (normalized === root || normalized.startsWith(root + "/"))) return normalized;
  }
  for (const [host, sandbox] of mappings) {
    if (!host) continue;
    const root = normalizePath(host);
    if (pathKey(normalized) === pathKey(root)) return sandbox;
    if (pathKey(normalized).startsWith(pathKey(root) + "/")) return sandbox + normalized.slice(root.length);
  }
  return absolute ? fallback : path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}
function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/");
  while (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized) && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
function pathKey(path) {
  return /^[a-zA-Z]:\//.test(path) ? path.toLowerCase() : path;
}
`,
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified patch to files in the local workspace using the apply_patch command.",
    parameters: objectSchema(
      {
        input: stringSchema("The entire contents of the apply_patch command."),
      },
      ["input"],
    ),
    runtime: String.raw`import { spawn } from "node:child_process";
${READ_STDIN}
const request = await readRequest();
const input = String((request.arguments ?? {}).input ?? "");
const cwd = request.cwd ?? process.env.NDX_TOOL_CWD ?? process.cwd();
const sandbox = process.env.NDX_SANDBOX_CONTAINER ?? "";
const sandboxCwd = toSandboxPath(cwd);
const result = await new Promise((resolveResult, reject) => {
  const child = sandbox.length > 0
    ? spawn("docker", ["exec", "-i", "-w", sandboxCwd, sandbox, "apply_patch"], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] })
    : spawn("apply_patch", [], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (exitCode) => { resolveResult({ exitCode, stdout, stderr }); });
  child.stdin.end(input);
});
process.stdout.write(JSON.stringify(result) + "\n");
function toSandboxPath(path) {
  const hostRoot = process.env.NDX_SANDBOX_HOST_WORKSPACE ?? "";
  const sandboxRoot = process.env.NDX_SANDBOX_WORKSPACE ?? "/workspace";
  const sandboxCwd = process.env.NDX_SANDBOX_CWD ?? process.env.NDX_TOOL_CWD ?? sandboxRoot;
  const hostGlobal = process.env.NDX_SANDBOX_HOST_GLOBAL ?? "";
  return mapPath(path, [
    [hostRoot, sandboxRoot],
    [hostGlobal, "/home/.ndx"],
  ], sandboxCwd);
}
function mapPath(path, mappings, fallback) {
  if (path.length === 0) return fallback;
  const absolute = isAbsolutePath(path);
  const normalized = absolute ? normalizePath(path) : path;
  if (normalized === "/root" || normalized.startsWith("/root/")) {
    return fallback + normalized.slice("/root".length);
  }
  for (const root of [fallback, "/workspace", "/home/.ndx"]) {
    if (root && (normalized === root || normalized.startsWith(root + "/"))) return normalized;
  }
  for (const [host, sandbox] of mappings) {
    if (!host) continue;
    const root = normalizePath(host);
    if (pathKey(normalized) === pathKey(root)) return sandbox;
    if (pathKey(normalized).startsWith(pathKey(root) + "/")) return sandbox + normalized.slice(root.length);
  }
  return absolute ? fallback : path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}
function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/");
  while (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized) && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
function pathKey(path) {
  return /^[a-zA-Z]:\//.test(path) ? path.toLowerCase() : path;
}
`,
  },
  {
    name: "list_dir",
    description:
      "Lists entries in a local directory with 1-indexed entry numbers and simple type labels.",
    parameters: objectSchema(
      {
        dir_path: stringSchema("Absolute path to the directory to list."),
        offset: integerSchema("The entry number to start listing from."),
        limit: integerSchema("The maximum number of entries to return."),
        depth: integerSchema("The maximum directory depth to traverse."),
      },
      ["dir_path"],
    ),
    runtime: String.raw`import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
const entries = [];
await collectEntries(toRuntimePath(String(args.dir_path ?? "")), Math.max(1, Number(args.depth ?? 1)), entries);
const offset = Math.max(1, Number(args.offset ?? 1));
const limit = Math.max(0, Number(args.limit ?? 200));
process.stdout.write(JSON.stringify({
  entries: entries.slice(offset - 1, offset - 1 + limit),
  next_offset: offset - 1 + limit < entries.length ? offset + limit : null
}) + "\n");
async function collectEntries(dir, depth, entries) {
  const names = await readdir(dir);
  names.sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path);
    const type = info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
    entries.push({ index: entries.length + 1, path, type });
    if (type === "directory" && depth > 1) {
      await collectEntries(path, depth - 1, entries);
    }
  }
}
function toRuntimePath(path) {
  const hostRoot = process.env.NDX_SANDBOX_HOST_WORKSPACE ?? "";
  const sandboxRoot = process.env.NDX_SANDBOX_WORKSPACE ?? "/workspace";
  const toolCwd = process.env.NDX_TOOL_CWD ?? process.cwd();
  const sandboxCwd = process.env.NDX_SANDBOX_CWD ?? toolCwd ?? sandboxRoot;
  const hostGlobal = process.env.NDX_SANDBOX_HOST_GLOBAL ?? "";
  const mapped = mapPath(path, [
    [hostRoot, sandboxRoot],
    [hostGlobal, "/home/.ndx"],
  ], sandboxCwd);
  return isAbsolutePath(mapped) ? resolve(mapped) : resolve(toolCwd, mapped || ".");
}
function mapPath(path, mappings, fallback) {
  if (path.length === 0) return fallback;
  const absolute = isAbsolutePath(path);
  const normalized = absolute ? normalizePath(path) : path;
  if (normalized === "/root" || normalized.startsWith("/root/")) {
    return fallback + normalized.slice("/root".length);
  }
  for (const root of [fallback, "/workspace", "/home/.ndx"]) {
    if (root && (normalized === root || normalized.startsWith(root + "/"))) return normalized;
  }
  for (const [host, sandbox] of mappings) {
    if (!host) continue;
    const root = normalizePath(host);
    if (pathKey(normalized) === pathKey(root)) return sandbox;
    if (pathKey(normalized).startsWith(pathKey(root) + "/")) return sandbox + normalized.slice(root.length);
  }
  return absolute ? fallback : path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}
function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/");
  while (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized) && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
function pathKey(path) {
  return /^[a-zA-Z]:\//.test(path) ? path.toLowerCase() : path;
}
`,
  },
  {
    name: "view_image",
    description:
      "View a local image from the filesystem when given a full filepath by the user.",
    parameters: objectSchema(
      {
        path: stringSchema("Local filesystem path to an image file."),
        detail: stringSchema(
          "Optional detail override. The supported value is original.",
        ),
      },
      ["path"],
    ),
    runtime: String.raw`import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
const path = toRuntimePath(String(args.path ?? ""));
const data = await readFile(path);
process.stdout.write(JSON.stringify({
  image_url: "data:" + mimeType(path) + ";base64," + data.toString("base64"),
  detail: args.detail === "original" ? "original" : null
}) + "\n");
function mimeType(path) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}
function toRuntimePath(path) {
  const hostRoot = process.env.NDX_SANDBOX_HOST_WORKSPACE ?? "";
  const sandboxRoot = process.env.NDX_SANDBOX_WORKSPACE ?? "/workspace";
  const toolCwd = process.env.NDX_TOOL_CWD ?? process.cwd();
  const sandboxCwd = process.env.NDX_SANDBOX_CWD ?? toolCwd ?? sandboxRoot;
  const hostGlobal = process.env.NDX_SANDBOX_HOST_GLOBAL ?? "";
  const mapped = mapPath(path, [
    [hostRoot, sandboxRoot],
    [hostGlobal, "/home/.ndx"],
  ], sandboxCwd);
  return isAbsolutePath(mapped) ? mapped : resolve(toolCwd, mapped || ".");
}
function mapPath(path, mappings, fallback) {
  if (path.length === 0) return fallback;
  const absolute = isAbsolutePath(path);
  const normalized = absolute ? normalizePath(path) : path;
  if (normalized === "/root" || normalized.startsWith("/root/")) {
    return fallback + normalized.slice("/root".length);
  }
  for (const root of [fallback, "/workspace", "/home/.ndx"]) {
    if (root && (normalized === root || normalized.startsWith(root + "/"))) return normalized;
  }
  for (const [host, sandbox] of mappings) {
    if (!host) continue;
    const root = normalizePath(host);
    if (pathKey(normalized) === pathKey(root)) return sandbox;
    if (pathKey(normalized).startsWith(pathKey(root) + "/")) return sandbox + normalized.slice(root.length);
  }
  return absolute ? fallback : path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}
function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/");
  while (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized) && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
function pathKey(path) {
  return /^[a-zA-Z]:\//.test(path) ? path.toLowerCase() : path;
}
`,
  },
  {
    name: "web_search",
    description:
      "Search the web through the configured Tavily-compatible websearch provider.",
    parameters: objectSchema(
      {
        query: stringSchema("Search query."),
        allowed_domains: arraySchema(
          stringSchema(),
          "Optional domains to restrict results to.",
        ),
      },
      ["query"],
    ),
    runtime: String.raw`${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
const apiKey = process.env.NDX_WEBSEARCH_API_KEY ?? "";
if (apiKey.length === 0) {
  process.stdout.write(JSON.stringify({
    isError: true,
    message: "web_search is configured but websearch.apiKey is empty"
  }) + "\n");
  process.exit(0);
}
const response = await fetch("https://api.tavily.com/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({
    query: String(args.query ?? ""),
    include_answer: true,
    include_raw_content: false,
    max_results: 5,
    include_domains: Array.isArray(args.allowed_domains) ? args.allowed_domains : undefined
  })
});
process.stdout.write(JSON.stringify(await response.json()) + "\n");
`,
  },
  {
    name: "image_generation",
    description:
      "Placeholder image generation contract for clients that provide an image backend.",
    parameters: objectSchema(
      {
        prompt: stringSchema("Image generation prompt."),
      },
      ["prompt"],
    ),
    runtime: String.raw`${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
process.stdout.write(JSON.stringify({
  isError: true,
  prompt: String(args.prompt ?? ""),
  message: "image_generation requires a client-provided image backend; none is configured in this TypeScript runtime."
}) + "\n");
`,
  },
  {
    name: "tool_suggest",
    description:
      "Suggests a missing connector or plugin when the user clearly wants a capability that is not currently available.",
    parameters: objectSchema(
      {
        tool_type: stringSchema("connector or plugin"),
        action_type: stringSchema("install or enable"),
        tool_id: stringSchema("Exact id from the discoverable tools list."),
        suggest_reason: stringSchema("Concise one-line reason."),
      },
      ["tool_type", "action_type", "tool_id", "suggest_reason"],
    ),
    runtime: String.raw`${READ_STDIN}
const request = await readRequest();
process.stdout.write(JSON.stringify({
  accepted: false,
  suggestion: request.arguments ?? {},
  message: "tool_suggest is exposed for parity; this TypeScript CLI cannot install plugins interactively."
}) + "\n");
`,
  },
  {
    name: "tool_search",
    description:
      "Searches filesystem tool metadata from core, project, global, and plugin tool layers.",
    parameters: objectSchema(
      {
        query: stringSchema("Search query for deferred tools."),
        limit: integerSchema(
          "Maximum number of tools to return; defaults to 8.",
        ),
      },
      ["query"],
    ),
    runtime: String.raw`import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
${READ_STDIN}
const request = await readRequest();
const args = request.arguments ?? {};
const terms = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
const limit = Number.isInteger(args.limit) ? args.limit : 8;
const dirs = [
  process.env.NDX_CORE_TOOLS_DIR,
  process.env.NDX_PROJECT_TOOLS_DIR,
  process.env.NDX_GLOBAL_TOOLS_DIR,
  process.env.NDX_PROJECT_PLUGINS_DIR,
  process.env.NDX_GLOBAL_PLUGINS_DIR
].filter(Boolean);
const tools = [];
for (const dir of dirs) {
  collectTools(dir, tools);
}
const matches = tools
  .map((tool) => ({ ...tool, score: score(tool, terms) }))
  .filter((tool) => tool.score > 0 && tool.name !== "tool_search")
  .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
  .slice(0, limit);
process.stdout.write(JSON.stringify({ tools: matches }) + "\n");
function collectTools(dir, tools) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    const manifest = join(child, "tool.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        const schema = parsed.schema ?? { function: parsed.function };
        tools.push({
          name: schema.function?.name ?? entry.name,
          description: schema.function?.description ?? "",
          path: manifest
        });
      } catch {
        tools.push({ name: entry.name, description: "", path: manifest });
      }
    } else {
      collectTools(join(child, "tools"), tools);
    }
  }
}
function score(tool, terms) {
  const haystack = (tool.name + " " + tool.description).toLowerCase();
  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}
`,
  },
  {
    name: "request_permissions",
    description:
      "Request additional filesystem or network permissions from the user.",
    parameters: objectSchema(
      {
        reason: stringSchema(
          "Optional short explanation for why additional permissions are needed.",
        ),
        permissions: objectSchema({
          network: objectSchema({ enabled: { type: "boolean" } }),
          file_system: objectSchema({
            read: arraySchema(stringSchema()),
            write: arraySchema(stringSchema()),
          }),
        }),
      },
      ["permissions"],
    ),
    runtime: String.raw`${READ_STDIN}
process.stdout.write(JSON.stringify({
  granted: false,
  message: "request_permissions is exposed for parity; this TypeScript CLI has no interactive approval client."
}) + "\n");
`,
  },
];

function objectSchema(
  properties: Record<string, JsonObject>,
  required: string[] = [],
): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function stringSchema(description?: string): JsonObject {
  return description === undefined
    ? { type: "string" }
    : { type: "string", description };
}

function integerSchema(description: string): JsonObject {
  return { type: "integer", description };
}

function arraySchema(items: JsonObject, description?: string): JsonObject {
  return description === undefined
    ? { type: "array", items }
    : { type: "array", items, description };
}
