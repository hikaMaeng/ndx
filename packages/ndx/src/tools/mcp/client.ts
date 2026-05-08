import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { NDX_DEFAULTS } from "../../config/defaults.js";
import type { NdxConfig } from "../../shared/types.js";
import type {
  McpResourceSettings,
  McpResourceTemplateSettings,
  McpServerSettings,
} from "./types.js";

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: unknown;
}

export async function callMcpTool(
  config: NdxConfig,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const server = config.mcp[serverName];
  if (server?.command === undefined) {
    return {
      content: [
        {
          type: "text",
          text: `MCP server ${serverName} has no command configured; static schema only.`,
        },
      ],
      isError: true,
    };
  }
  return await callConfiguredMcpTool(config, server, toolName, args);
}

export async function callConfiguredMcpTool(
  config: NdxConfig,
  server: McpServerSettings,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return await callJsonRpc(config, server, "tools/call", {
    name: toolName,
    arguments: args,
  });
}

export async function listMcpServerTools(
  config: NdxConfig,
  server: McpServerSettings,
): Promise<
  Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>
> {
  const result = await callJsonRpc(config, server, "tools/list", {});
  if (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { tools?: unknown }).tools)
  ) {
    return (result as { tools: unknown[] }).tools.flatMap((tool) => {
      if (typeof tool !== "object" || tool === null) {
        return [];
      }
      const entry = tool as {
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
      };
      if (typeof entry.name !== "string") {
        return [];
      }
      return [
        {
          name: entry.name,
          description:
            typeof entry.description === "string"
              ? entry.description
              : undefined,
          inputSchema:
            typeof entry.inputSchema === "object" &&
            entry.inputSchema !== null &&
            !Array.isArray(entry.inputSchema)
              ? (entry.inputSchema as Record<string, unknown>)
              : undefined,
        },
      ];
    });
  }
  return [];
}

export async function listConfiguredMcpResources(
  config: NdxConfig,
  serverName?: string,
): Promise<Array<McpResourceSettings & { server: string }>> {
  const resources = [...listStaticMcpResources(config, serverName)];
  for (const [server, settings] of Object.entries(
    selectServers(config, serverName),
  )) {
    if (settings.command === undefined) {
      continue;
    }
    const result = await callJsonRpc(config, settings, "resources/list", {});
    if (
      typeof result === "object" &&
      result !== null &&
      Array.isArray((result as { resources?: unknown }).resources)
    ) {
      resources.push(
        ...(result as { resources: unknown[] }).resources.flatMap((resource) =>
          normalizeResource(server, resource),
        ),
      );
    }
  }
  return uniqueByServerUri(resources);
}

export async function listConfiguredMcpResourceTemplates(
  config: NdxConfig,
  serverName?: string,
): Promise<Array<McpResourceTemplateSettings & { server: string }>> {
  const templates = [...listStaticMcpResourceTemplates(config, serverName)];
  for (const [server, settings] of Object.entries(
    selectServers(config, serverName),
  )) {
    if (settings.command === undefined) {
      continue;
    }
    const result = await callJsonRpc(
      config,
      settings,
      "resources/templates/list",
      {},
    );
    if (
      typeof result === "object" &&
      result !== null &&
      Array.isArray(
        (result as { resourceTemplates?: unknown }).resourceTemplates,
      )
    ) {
      templates.push(
        ...(
          result as { resourceTemplates: unknown[] }
        ).resourceTemplates.flatMap((template) =>
          normalizeResourceTemplate(server, template),
        ),
      );
    }
  }
  return uniqueByServerTemplate(templates);
}

export async function readConfiguredMcpResource(
  config: NdxConfig,
  serverName: string,
  uri: string,
): Promise<unknown[]> {
  const staticResource = readStaticMcpResource(config, serverName, uri);
  if (staticResource !== undefined) {
    if (staticResource.text !== undefined) {
      return [
        {
          uri: staticResource.uri,
          mimeType: staticResource.mimeType,
          text: staticResource.text,
        },
      ];
    }
    return [{ ...staticResource }];
  }
  const server = config.mcp[serverName];
  if (server?.command === undefined) {
    throw new Error(`MCP server ${serverName} has no readable resource ${uri}`);
  }
  const result = await callJsonRpc(config, server, "resources/read", { uri });
  if (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { contents?: unknown }).contents)
  ) {
    return (result as { contents: unknown[] }).contents;
  }
  return [];
}

export function listStaticMcpResources(
  config: NdxConfig,
  serverName?: string,
): Array<McpResourceSettings & { server: string }> {
  return Object.entries(selectServers(config, serverName)).flatMap(
    ([server, settings]) =>
      (settings.resources ?? []).map((resource) => ({ ...resource, server })),
  );
}

export function listStaticMcpResourceTemplates(
  config: NdxConfig,
  serverName?: string,
): Array<McpResourceTemplateSettings & { server: string }> {
  return Object.entries(selectServers(config, serverName)).flatMap(
    ([server, settings]) =>
      (settings.resourceTemplates ?? []).map((template) => ({
        ...template,
        server,
      })),
  );
}

export function readStaticMcpResource(
  config: NdxConfig,
  serverName: string,
  uri: string,
): McpResourceSettings | undefined {
  return config.mcp[serverName]?.resources?.find(
    (resource) => resource.uri === uri,
  );
}

function selectServers(
  config: NdxConfig,
  serverName: string | undefined,
): Record<string, McpServerSettings> {
  if (serverName === undefined) {
    return config.mcp;
  }
  const server = config.mcp[serverName];
  return server === undefined ? {} : { [serverName]: server };
}

function normalizeResource(
  server: string,
  resource: unknown,
): Array<McpResourceSettings & { server: string }> {
  if (typeof resource !== "object" || resource === null) {
    return [];
  }
  const entry = resource as {
    uri?: unknown;
    name?: unknown;
    description?: unknown;
    mimeType?: unknown;
    text?: unknown;
  };
  if (typeof entry.uri !== "string") {
    return [];
  }
  return [
    {
      server,
      uri: entry.uri,
      name: typeof entry.name === "string" ? entry.name : undefined,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
      text: typeof entry.text === "string" ? entry.text : undefined,
    },
  ];
}

function normalizeResourceTemplate(
  server: string,
  template: unknown,
): Array<McpResourceTemplateSettings & { server: string }> {
  if (typeof template !== "object" || template === null) {
    return [];
  }
  const entry = template as {
    uriTemplate?: unknown;
    name?: unknown;
    description?: unknown;
    mimeType?: unknown;
  };
  if (typeof entry.uriTemplate !== "string") {
    return [];
  }
  return [
    {
      server,
      uriTemplate: entry.uriTemplate,
      name: typeof entry.name === "string" ? entry.name : undefined,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
    },
  ];
}

function uniqueByServerUri<T extends { server: string; uri: string }>(
  resources: T[],
): T[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.server}\0${resource.uri}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueByServerTemplate<
  T extends { server: string; uriTemplate: string },
>(templates: T[]): T[] {
  const seen = new Set<string>();
  return templates.filter((template) => {
    const key = `${template.server}\0${template.uriTemplate}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function callJsonRpc(
  config: NdxConfig,
  server: McpServerSettings,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return await new Promise((resolveCall, reject) => {
    const sandbox = config.env.NDX_SANDBOX_CONTAINER;
    const useSandbox = sandbox !== undefined && sandbox.length > 0;
    const child = spawn(
      useSandbox ? "docker" : (server.command ?? ""),
      useSandbox
        ? [
            "exec",
            "-i",
            "-w",
            server.cwd === undefined
              ? (config.env.NDX_SANDBOX_CWD ??
                NDX_DEFAULTS.containerWorkspaceDir)
              : mapHostPathToSandbox(config, server.cwd),
            ...Object.entries(sandboxMcpEnv(config, server)).flatMap(
              ([key, value]) => ["-e", `${key}=${value}`],
            ),
            sandbox,
            sandboxCommand(server.command ?? ""),
            ...(server.args ?? []).map((arg) =>
              mapHostPathToSandbox(config, arg),
            ),
          ]
        : (server.args ?? []),
      {
        cwd:
          server.cwd === undefined
            ? undefined
            : useSandbox
              ? undefined
              : resolve(server.cwd),
        env: useSandbox
          ? process.env
          : { ...process.env, ...(server.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", () => {
      const response = parseLastJsonRpcResponse(stdout);
      if (response?.error !== undefined) {
        reject(new Error(JSON.stringify(response.error)));
        return;
      }
      if (response !== undefined) {
        resolveCall(response.result);
        return;
      }
      resolveCall({
        content: [{ type: "text", text: stderr || stdout }],
        isError: stderr.length > 0,
      });
    });
    writeRequest(child.stdin, 1, "initialize", {
      protocolVersion: NDX_DEFAULTS.mcpProtocolVersion,
      capabilities: {},
      clientInfo: {
        name: NDX_DEFAULTS.mcpClientName,
        version: NDX_DEFAULTS.mcpClientVersion,
      },
    });
    writeNotification(child.stdin, "notifications/initialized", {});
    writeRequest(child.stdin, 2, method, params);
    child.stdin.end();
  });
}

function sandboxMcpEnv(
  config: NdxConfig,
  server: McpServerSettings,
): Record<string, string> {
  return {
    ...config.env,
    ...(server.env ?? {}),
    NDX_TOOL_EXECUTION_ENV: "container",
    NDX_GLOBAL_DIR: NDX_DEFAULTS.containerGlobalDir,
    NDX_SANDBOX_CONTAINER: "",
  };
}

function sandboxCommand(command: string): string {
  return command === process.execPath ? "node" : command;
}

function mapHostPathToSandbox(config: NdxConfig, value: string): string {
  const hostWorkspace = config.env.NDX_SANDBOX_HOST_WORKSPACE;
  const sandboxWorkspace =
    config.env.NDX_SANDBOX_WORKSPACE ?? NDX_DEFAULTS.containerWorkspaceDir;
  const sandboxCwd = config.env.NDX_SANDBOX_CWD ?? sandboxWorkspace;
  const hostGlobal = config.paths.globalDir;
  const resolved = value.startsWith("/") ? resolve(value) : value;
  if (hostWorkspace !== undefined && hostWorkspace.length > 0) {
    const workspace = resolve(hostWorkspace);
    if (resolved === workspace) {
      return sandboxWorkspace;
    }
    if (resolved.startsWith(`${workspace}/`)) {
      return `${sandboxWorkspace}${resolved.slice(workspace.length)}`;
    }
  }
  const global = resolve(hostGlobal);
  if (resolved === global) {
    return NDX_DEFAULTS.containerGlobalDir;
  }
  if (resolved.startsWith(`${global}/`)) {
    return `${NDX_DEFAULTS.containerGlobalDir}${resolved.slice(global.length)}`;
  }
  return value.startsWith("/") ? sandboxCwd : value;
}

function writeRequest(
  stdin: NodeJS.WritableStream,
  id: number,
  method: string,
  params: Record<string, unknown>,
): void {
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

function writeNotification(
  stdin: NodeJS.WritableStream,
  method: string,
  params: Record<string, unknown>,
): void {
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function parseLastJsonRpcResponse(output: string): JsonRpcResponse | undefined {
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonRpcResponse;
      } catch {
        return undefined;
      }
    })
    .filter((line): line is JsonRpcResponse => line?.id === 2)
    .at(-1);
}
