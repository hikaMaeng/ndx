import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NDX_DEFAULTS } from "../config/defaults.js";
import { SessionClient } from "../session/client.js";
import { defaultDockerSandboxImage } from "../session/docker-sandbox.js";

export interface ManagedServerState {
  projectDir: string;
  socketUrl: string;
  dashboardUrl: string;
  socketPort: number;
  dashboardPort: number;
  image: string;
  homeDir: string;
  systemDir: string;
  mock: boolean;
  reachable: boolean;
}

export interface ManagedServerOptions {
  cwd: string;
  serverUrl?: string;
  print?: (message: string) => void;
}

/** Attach to the requested ndx server, returning fallback metadata on miss. */
export async function ensureManagedServer(
  options: ManagedServerOptions,
): Promise<ManagedServerState> {
  const projectDir = resolve(options.cwd);
  const socketUrl = normalizeSocketUrl(options.serverUrl);
  const print = options.print ?? console.error;
  const state = createManagedServerState(projectDir, socketUrl);

  if (await canConnect(socketUrl)) {
    return { ...state, reachable: true };
  }

  print(
    `[server] ${socketUrl} is not reachable; starting local default server`,
  );
  return { ...state, reachable: false };
}

export function normalizeSocketUrl(value: string | undefined): string {
  const raw =
    value === undefined || value.length === 0 ? NDX_DEFAULTS.host : value;
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
    const parsed = new URL(raw);
    if (parsed.port.length === 0) {
      parsed.port = String(NDX_DEFAULTS.socketPort);
    }
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  }
  const withPort = raw.includes(":")
    ? raw
    : `${raw}:${NDX_DEFAULTS.socketPort}`;
  return `ws://${withPort}`;
}

function createManagedServerState(
  projectDir: string,
  socketUrl: string,
): ManagedServerState {
  const socketPort = portFromSocketUrl(socketUrl);
  const configuredDashboardPort = process.env.NDX_DASHBOARD_PORT;
  const dashboardPort =
    configuredDashboardPort === undefined
      ? Number.NaN
      : Number(configuredDashboardPort);
  const resolvedDashboardPort = Number.isInteger(dashboardPort)
    ? dashboardPort
    : NDX_DEFAULTS.dashboardPort;
  const homeDir = NDX_DEFAULTS.globalDir;
  const systemDir = join(homeDir, NDX_DEFAULTS.systemDir);
  const mock = !(
    existsSync(join(homeDir, NDX_DEFAULTS.settingsFile)) ||
    existsSync(
      join(projectDir, NDX_DEFAULTS.configDir, NDX_DEFAULTS.settingsFile),
    )
  );
  return {
    projectDir,
    socketUrl,
    dashboardUrl: `http://${NDX_DEFAULTS.host}:${resolvedDashboardPort}`,
    socketPort,
    dashboardPort: resolvedDashboardPort,
    image: defaultDockerSandboxImage(),
    homeDir,
    systemDir,
    mock,
    reachable: false,
  };
}

function portFromSocketUrl(socketUrl: string): number {
  const parsed = new URL(socketUrl);
  const port = Number.parseInt(
    parsed.port || String(NDX_DEFAULTS.socketPort),
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid ndx server port: ${socketUrl}`);
  }
  return port;
}

export async function canConnect(url: string): Promise<boolean> {
  try {
    const client = await SessionClient.connect(url);
    try {
      await client.request("account/login", {
        username: "defaultUser",
        password: "",
      });
      const initialize = await client.request<{ server?: unknown }>(
        "initialize",
      );
      return initialize.server === NDX_DEFAULTS.serverName;
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}
