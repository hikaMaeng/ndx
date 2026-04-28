import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { NdxConfig } from "../../types.js";
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
  return await callJsonRpc(server, "tools/call", {
    name: toolName,
    arguments: args,
  });
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

async function callJsonRpc(
  server: McpServerSettings,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return await new Promise((resolveCall, reject) => {
    const child = spawn(server.command ?? "", server.args ?? [], {
      cwd: server.cwd === undefined ? undefined : resolve(server.cwd),
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
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
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ndx", version: "0.1.0" },
    });
    writeNotification(child.stdin, "notifications/initialized", {});
    writeRequest(child.stdin, 2, method, params);
    child.stdin.end();
  });
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
