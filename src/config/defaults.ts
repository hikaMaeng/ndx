import { homedir } from "node:os";
import { join } from "node:path";

/** Code-owned runtime defaults shared by CLI, server, tools, and docs. */
export const NDX_DEFAULTS = {
  host: "127.0.0.1",
  socketPort: 45123,
  dashboardPort: 45124,
  globalDir: join(homedir(), ".ndx"),
  configDir: ".ndx",
  settingsFile: "settings.json",
  searchFile: "search.json",
  systemDir: "system",
  dataDirFallback: "/home/.ndx/system",
  containerWorkspaceDir: "/workspace",
  containerGlobalDir: "/home/.ndx",
  sandboxImage: "hika00/ndx-sandbox:0.1.1",
  permissionMode: "danger-full-access",
  maxTurns: 8,
  shellTimeoutMs: 120_000,
  imageGenerationEnabled: false,
  mockProviderUrl: "http://localhost/v1",
  serverName: "ndx-ts-session-server",
  protocolVersion: 1,
  mcpProtocolVersion: "2024-11-05",
  mcpClientName: "ndx",
  mcpClientVersion: "0.1.0",
  toolAuditLog: "/home/.ndx/system/logs/tool-executions.jsonl",
} as const;
