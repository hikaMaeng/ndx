import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

const DEFAULT_SOCKET_PORT = 45123;
const DEFAULT_DASHBOARD_PORT = 45124;

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
  const raw = value === undefined || value.length === 0 ? "127.0.0.1" : value;
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
    const parsed = new URL(raw);
    if (parsed.port.length === 0) {
      parsed.port = String(DEFAULT_SOCKET_PORT);
    }
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  }
  const withPort = raw.includes(":") ? raw : `${raw}:${DEFAULT_SOCKET_PORT}`;
  return `ws://${withPort}`;
}

function createManagedServerState(
  projectDir: string,
  socketUrl: string,
): ManagedServerState {
  const socketPort = portFromSocketUrl(socketUrl);
  const dashboardPort = Number(process.env.NDX_DASHBOARD_PORT ?? "");
  const resolvedDashboardPort = Number.isInteger(dashboardPort)
    ? dashboardPort
    : DEFAULT_DASHBOARD_PORT;
  const homeDir = join(homedir(), ".ndx");
  const systemDir = join(homeDir, "system");
  const mock = !(
    existsSync(join(homeDir, "settings.json")) ||
    existsSync(join(projectDir, ".ndx", "settings.json"))
  );
  return {
    projectDir,
    socketUrl,
    dashboardUrl: `http://127.0.0.1:${resolvedDashboardPort}`,
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
  const port = Number.parseInt(parsed.port || String(DEFAULT_SOCKET_PORT), 10);
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
      return initialize.server === "ndx-ts-session-server";
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}
