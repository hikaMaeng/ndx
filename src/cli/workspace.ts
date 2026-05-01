import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { SessionClient } from "../session/client.js";

export interface ManagedServerState {
  workspaceDir: string;
  composeFile: string;
  socketUrl: string;
  dashboardUrl: string;
  socketPort: number;
  dashboardPort: number;
  image: string;
  homeDir: string;
  systemDir: string;
  mock: boolean;
}

export interface ManagedServerOptions {
  cwd: string;
  workspaceDir?: string;
  serverUrl?: string;
  print?: (message: string) => void;
  manageDocker?: boolean;
}

const DEFAULT_IMAGE = "hika00/ndx:latest";
const DEFAULT_SOCKET_PORT = 45123;
const DEFAULT_DASHBOARD_PORT = 45124;
const CONTAINER_NDX_HOME = "/home/.ndx";
const CONTAINER_WORKSPACE_DIR = "/workspace";

/** Attach to the requested ndx server, or start the Docker-managed fallback. */
export async function ensureManagedServer(
  options: ManagedServerOptions,
): Promise<ManagedServerState> {
  const workspaceDir = resolve(options.workspaceDir ?? options.cwd);
  const socketUrl = normalizeSocketUrl(options.serverUrl);
  const print = options.print ?? console.error;
  const state = createManagedServerState(workspaceDir, socketUrl);

  if (await canConnect(socketUrl)) {
    return state;
  }

  writeComposeFile(state);
  if (options.manageDocker === false) {
    return state;
  }

  print(`[server] starting ${socketUrl}`);
  await composeUp(state.composeFile);
  if (await canConnect(socketUrl)) {
    return state;
  }
  throw new Error(`ndx server is not reachable at ${socketUrl}`);
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
  workspaceDir: string,
  socketUrl: string,
): ManagedServerState {
  const socketPort = portFromSocketUrl(socketUrl);
  const dashboardPort = Number(process.env.NDX_DASHBOARD_PORT ?? "");
  const resolvedDashboardPort = Number.isInteger(dashboardPort)
    ? dashboardPort
    : DEFAULT_DASHBOARD_PORT;
  const homeDir = join(homedir(), ".ndx");
  const systemDir = join(homeDir, "system");
  const key = createHash("sha256").update(workspaceDir).digest("hex");
  const composeFile = join(systemDir, "managed", key, "docker-compose.yml");
  const mock = !(
    existsSync(join(homeDir, "settings.json")) ||
    existsSync(join(workspaceDir, ".ndx", "settings.json"))
  );
  return {
    workspaceDir,
    composeFile,
    socketUrl,
    dashboardUrl: `http://127.0.0.1:${resolvedDashboardPort}`,
    socketPort,
    dashboardPort: resolvedDashboardPort,
    image: process.env.NDX_DOCKER_IMAGE ?? DEFAULT_IMAGE,
    homeDir,
    systemDir,
    mock,
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

function writeComposeFile(state: ManagedServerState): void {
  mkdirSync(dirname(state.composeFile), { recursive: true });
  mkdirSync(state.homeDir, { recursive: true });
  mkdirSync(state.systemDir, { recursive: true });
  writeFileSync(
    state.composeFile,
    [
      "services:",
      "  ndx-agent:",
      `    image: ${JSON.stringify(state.image)}`,
      `    working_dir: ${CONTAINER_WORKSPACE_DIR}`,
      "    command:",
      "      - ndxserver",
      ...(state.mock ? ["      - --mock"] : []),
      "      - --cwd",
      `      - ${CONTAINER_WORKSPACE_DIR}`,
      "      - --listen",
      "      - 0.0.0.0:45123",
      "      - --dashboard-listen",
      "      - 0.0.0.0:45124",
      "    environment:",
      "      HOME: /home",
      "    ports:",
      `      - \"127.0.0.1:${state.socketPort}:45123\"`,
      `      - \"127.0.0.1:${state.dashboardPort}:45124\"`,
      "    volumes:",
      "      - type: bind",
      `        source: ${JSON.stringify(state.workspaceDir)}`,
      `        target: ${CONTAINER_WORKSPACE_DIR}`,
      "      - type: bind",
      `        source: ${JSON.stringify(state.homeDir)}`,
      `        target: ${CONTAINER_NDX_HOME}`,
      "      - type: bind",
      "        source: /var/run/docker.sock",
      "        target: /var/run/docker.sock",
      "    stdin_open: true",
      "    tty: true",
      "",
    ].join("\n"),
  );
}

async function canConnect(url: string): Promise<boolean> {
  try {
    const client = await SessionClient.connect(url);
    try {
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

async function composeUp(composeFile: string): Promise<void> {
  await run("docker", ["compose", "-f", composeFile, "up", "-d"]);
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
