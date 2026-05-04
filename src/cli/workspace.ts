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

export interface DetachedManagedServerLaunchOptions {
  cwd: string;
  entrypoint: string;
  socketUrl: string;
  dashboardPort?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
}

export interface DetachedManagedServerLaunch {
  command: string;
  args: string[];
  cwd: string;
  detached: boolean;
  env: Record<string, string>;
  windowsHide: boolean;
  diagnostic: DetachedManagedServerDiagnostic;
}

export interface DetachedManagedServerDiagnostic {
  platform: NodeJS.Platform;
  launcher: string;
  execPath: string;
  serverArgs: string[];
  logPaths: string[];
  hostLogPath?: string;
}

export interface ConnectionProbeResult {
  reachable: boolean;
  stage: "connect" | "login" | "initialize" | "server-name";
  error?: string;
}

/** Attach to the requested ndx server, returning fallback metadata on miss. */
export async function ensureManagedServer(
  options: ManagedServerOptions,
): Promise<ManagedServerState> {
  const projectDir = resolve(options.cwd);
  const socketUrl = normalizeSocketUrl(options.serverUrl);
  const print = options.print ?? console.error;
  const state = createManagedServerState(projectDir, socketUrl);

  const probe = await probeManagedServer(socketUrl);
  if (probe.reachable) {
    return { ...state, reachable: true };
  }

  print(
    `[server] ${socketUrl} is not reachable; starting local default server`,
  );
  print(
    `[server] initial probe failed at ${probe.stage}${
      probe.error === undefined ? "" : `: ${probe.error}`
    }`,
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
  return (await probeManagedServer(url)).reachable;
}

export async function probeManagedServer(
  url: string,
): Promise<ConnectionProbeResult> {
  let client: SessionClient | undefined;
  try {
    client = await SessionClient.connect(url);
  } catch (error) {
    return { reachable: false, stage: "connect", error: describeError(error) };
  }
  try {
    try {
      await client.request("account/login", {
        username: "defaultuser",
      });
    } catch (error) {
      return { reachable: false, stage: "login", error: describeError(error) };
    }
    let initialize: { server?: unknown };
    try {
      initialize = await client.request<{ server?: unknown }>("initialize");
    } catch (error) {
      return {
        reachable: false,
        stage: "initialize",
        error: describeError(error),
      };
    }
    if (initialize.server !== NDX_DEFAULTS.serverName) {
      return {
        reachable: false,
        stage: "server-name",
        error: `unexpected server ${JSON.stringify(initialize.server)}`,
      };
    }
    return { reachable: true, stage: "server-name" };
  } finally {
    client.close();
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [`${error.name}: ${error.message}`];
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) {
      parts.push(`code=${String(code)}`);
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      parts.push(`cause=${String(cause)}`);
    }
    if (error.stack !== undefined) {
      parts.push(error.stack.split(/\r?\n/).slice(1, 3).join(" | ").trim());
    }
    return parts.filter((part) => part.length > 0).join("; ");
  }
  return String(error);
}

export function detachedManagedServerLaunch(
  options: DetachedManagedServerLaunchOptions,
): DetachedManagedServerLaunch {
  const socket = new URL(options.socketUrl);
  const listenHost = socket.hostname || NDX_DEFAULTS.host;
  const listenPort = socket.port || String(NDX_DEFAULTS.socketPort);
  const dashboardPort =
    options.dashboardPort ?? String(NDX_DEFAULTS.dashboardPort);
  const serverArgs = [
    options.entrypoint,
    "serve",
    "--cwd",
    options.cwd,
    "--listen",
    `${listenHost}:${listenPort}`,
    "--dashboard-listen",
    `${NDX_DEFAULTS.host}:${dashboardPort}`,
  ];
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const env = {
    NDX_MANAGED_SERVER: "1",
  };
  const diagnosticBase = {
    platform,
    execPath,
    serverArgs,
  };
  if (platform === "win32") {
    const hostLogPath = join(
      process.env.TEMP ?? process.env.TMP ?? options.cwd,
      "ndx-managed-server-host.log",
    );
    return {
      command: execPath,
      args: serverArgs,
      cwd: options.cwd,
      detached: true,
      env,
      windowsHide: true,
      diagnostic: {
        ...diagnosticBase,
        launcher: "windows-service-trigger-node",
        logPaths: [],
        hostLogPath,
      },
    };
  }
  if (platform === "darwin") {
    return {
      command: "/bin/sh",
      args: [
        "-c",
        [
          "work=$1",
          "shift",
          'cd "$work" || exit 1',
          'nohup "$@" >/dev/null 2>&1 </dev/null &',
        ].join("; "),
        "ndx-managed-server",
        options.cwd,
        execPath,
        ...serverArgs,
      ],
      cwd: options.cwd,
      detached: true,
      env,
      windowsHide: true,
      diagnostic: {
        ...diagnosticBase,
        launcher: "darwin-nohup",
        logPaths: [],
      },
    };
  }
  if (platform === "linux") {
    return {
      command: "/bin/sh",
      args: [
        "-c",
        [
          "work=$1",
          "shift",
          'cd "$work" || exit 1',
          "if command -v setsid >/dev/null 2>&1; then",
          'setsid "$@" >/dev/null 2>&1 </dev/null &',
          "else",
          'nohup "$@" >/dev/null 2>&1 </dev/null &',
          "fi",
        ].join("; "),
        "ndx-managed-server",
        options.cwd,
        execPath,
        ...serverArgs,
      ],
      cwd: options.cwd,
      detached: true,
      env,
      windowsHide: true,
      diagnostic: {
        ...diagnosticBase,
        launcher: "linux-setsid-nohup",
        logPaths: [],
      },
    };
  }
  return {
    command: execPath,
    args: serverArgs,
    cwd: options.cwd,
    detached: true,
    env,
    windowsHide: true,
    diagnostic: {
      ...diagnosticBase,
      launcher: "direct-detached-spawn",
      logPaths: [],
    },
  };
}
