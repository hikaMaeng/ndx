import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { SessionClient } from "../session/client.js";
import { resolveCliStateDir } from "./auth.js";

export interface WorkspaceState {
  root: string;
  composeFile: string;
  socketUrl: string;
  dashboardUrl: string;
  socketPort: number;
  dashboardPort: number;
  image: string;
  mock: boolean;
  updatedAt: number;
}

export interface WorkspaceBootstrapOptions {
  cwd: string;
  question?: (prompt: string) => Promise<string>;
  print?: (message: string) => void;
  manageDocker?: boolean;
}

const DEFAULT_IMAGE = "hika00/ndx:latest";

/** Ensure a host CLI has a workspace-managed Docker session server to attach to. */
export async function ensureWorkspaceServer(
  options: WorkspaceBootstrapOptions,
): Promise<WorkspaceState> {
  const root = resolve(options.cwd);
  const print = options.print ?? console.error;
  const existing = readWorkspaceState(root);
  if (existing !== undefined && (await canConnect(existing.socketUrl))) {
    return existing;
  }
  if (existing !== undefined && options.manageDocker !== false) {
    await composeUp(existing.composeFile);
    if (await canConnect(existing.socketUrl)) {
      return existing;
    }
  }
  const state = await createWorkspaceState(root, options);
  print(`[workspace] using ${state.root}`);
  print(`[workspace] socket ${state.socketUrl}`);
  if (options.manageDocker !== false) {
    await composeUp(state.composeFile);
  }
  return state;
}

export function workspaceStateFile(root: string): string {
  const key = createHash("sha256").update(resolve(root)).digest("hex");
  return join(resolveCliStateDir(), "workspaces", `${key}.json`);
}

async function createWorkspaceState(
  root: string,
  options: WorkspaceBootstrapOptions,
): Promise<WorkspaceState> {
  if (options.question !== undefined) {
    const answer = (
      await options.question(
        [
          "ndx workspace is not ready.",
          `Use ${root} as workspace root? [1=yes, 2=exit] `,
        ].join("\n"),
      )
    ).trim();
    if (answer.length > 0 && answer !== "1") {
      throw new Error("workspace setup cancelled");
    }
  }
  const socketPort = await freePort();
  const dashboardPort = await freePort();
  const image = process.env.NDX_DOCKER_IMAGE ?? DEFAULT_IMAGE;
  const composeFile = join(root, ".ndx", "managed", "docker-compose.yml");
  const mock = ensureDefaultSettings(root);
  const state: WorkspaceState = {
    root,
    composeFile,
    socketUrl: `ws://127.0.0.1:${socketPort}`,
    dashboardUrl: `http://127.0.0.1:${dashboardPort}`,
    socketPort,
    dashboardPort,
    image,
    mock,
    updatedAt: Date.now(),
  };
  writeComposeFile(state);
  writeWorkspaceState(state);
  return state;
}

function readWorkspaceState(root: string): WorkspaceState | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(workspaceStateFile(root), "utf8"),
    ) as WorkspaceState;
    if (
      typeof parsed.root === "string" &&
      typeof parsed.composeFile === "string" &&
      typeof parsed.socketUrl === "string"
    ) {
      return parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return undefined;
}

function writeWorkspaceState(state: WorkspaceState): void {
  const file = workspaceStateFile(state.root);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

function writeComposeFile(state: WorkspaceState): void {
  mkdirSync(dirname(state.composeFile), { recursive: true });
  writeFileSync(
    state.composeFile,
    [
      "services:",
      "  ndx-agent:",
      `    image: ${JSON.stringify(state.image)}`,
      "    working_dir: /workspace",
      "    command:",
      "      - ndxserver",
      ...(state.mock ? ["      - --mock"] : []),
      "      - --listen",
      "      - 0.0.0.0:45123",
      "      - --dashboard-listen",
      "      - 0.0.0.0:45124",
      "    ports:",
      `      - \"127.0.0.1:${state.socketPort}:45123\"`,
      `      - \"127.0.0.1:${state.dashboardPort}:45124\"`,
      "    volumes:",
      `      - ${JSON.stringify(state.root)}:/workspace`,
      `      - ${JSON.stringify(join(state.root, ".ndx", "home"))}:/home/.ndx`,
      `      - ${JSON.stringify(join(state.root, ".ndx", "data"))}:/home/.ndx-data`,
      "    stdin_open: true",
      "    tty: true",
      "",
    ].join("\n"),
  );
}

function ensureDefaultSettings(root: string): boolean {
  const settings = join(root, ".ndx", "settings.json");
  if (existsSync(settings)) {
    return false;
  }
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(
    settings,
    `${JSON.stringify(
      {
        model: "mock",
        providers: {
          mock: { type: "openai", key: "", url: "http://127.0.0.1:1/v1" },
        },
        models: [{ name: "mock", provider: "mock" }],
      },
      null,
      2,
    )}\n`,
  );
  return true;
}

async function canConnect(url: string): Promise<boolean> {
  try {
    const client = await SessionClient.connect(url);
    try {
      await client.request("initialize");
    } finally {
      client.close();
    }
    return true;
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

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  if (address === null || typeof address === "string") {
    throw new Error("failed to allocate a free local port");
  }
  return address.port;
}
