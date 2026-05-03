#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { NDX_DEFAULTS } from "../config/defaults.js";
import { readPackageVersion } from "../config/package-version.js";
import { createLoginStore } from "./auth.js";
import {
  createGlobalSettingsWithWizard,
  repairSettingsWithWizard,
} from "./settings-wizard.js";
import {
  CliSessionController,
  interactiveHelp,
  printWelcomeLogo,
} from "./session-client.js";
import {
  canConnect,
  detachedManagedServerLaunch,
  ensureManagedServer,
  normalizeSocketUrl,
  probeManagedServer,
} from "./workspace.js";
import { loadConfig, resolveGlobalNdxDir } from "../config/index.js";
import { createRoutedModelClient } from "../model/factory.js";
import { MockModelClient } from "../model/mock-client.js";
import { SessionClient } from "../session/client.js";
import { SessionServer, type SessionServerAddress } from "../session/server.js";
import type { LoadedConfig, ModelClient, NdxConfig } from "../shared/types.js";

interface CliArgs {
  cwd: string;
  mock: boolean;
  mode: "run" | "serve" | "connect";
  listen: string;
  dashboardListen: string;
  connectUrl?: string;
  serverUrl?: string;
  prompt?: string;
  interactive: boolean;
  help: boolean;
  version: boolean;
}

interface CliPrompt {
  question(prompt: string): Promise<string>;
  close(): void;
}

async function main(): Promise<void> {
  const invokedAsServer = /(^|[/\\])ndxserver(?:\.[cm]?js)?$/.test(
    process.argv[1] ?? "",
  );
  const args = parseArgs(process.argv.slice(2), invokedAsServer);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(readPackageVersion());
    return;
  }

  if (shouldUseManagedWorkspace(args)) {
    await runManagedWorkspace(args);
    return;
  }

  const { config, sources } = await loadConfigForCli(args);
  if (sources.length > 0) {
    console.error(`[config] ${sources.join(", ")}`);
  }

  if (args.mode === "serve") {
    await runServer({ args, config, sources });
    return;
  }

  if (args.mode === "connect") {
    await runConnected({ args, prompt: args.prompt ?? readStdin() });
    return;
  }

  if (args.interactive) {
    await runInteractive({ args, config, sources });
    return;
  }

  const prompt = args.prompt ?? readStdin();
  await withEmbeddedServer({ args, config, sources }, async (client) => {
    const session = new CliSessionController({
      client,
      cwd: args.cwd,
      loginStore: createLoginStore(),
    });
    await session.initialize();
    await session.startSession();
    await session.runPrompt(prompt);
  });
}

async function loadConfigForCli(args: CliArgs): Promise<LoadedConfig> {
  try {
    return loadConfig(args.cwd);
  } catch (error) {
    if (args.mock && isMissingSettingsError(error)) {
      return {
        config: mockConfig(args.cwd),
        sources: ["mock defaults (--mock, no settings found)"],
      };
    }
    if (!isMissingSettingsError(error) || !process.stdin.isTTY) {
      if (!process.stdin.isTTY) {
        throw error;
      }
      const rl = createCliPrompt();
      try {
        console.error(`settings rewrite required: ${errorMessage(error)}`);
        const repaired = await repairSettingsWithWizard(args.cwd, {
          question: (prompt) => rl.question(prompt),
          print: (message) => console.error(message),
        });
        console.error(`[config] repaired ${repaired.join(", ")}`);
      } finally {
        rl.close();
      }
      return loadConfig(args.cwd);
    }
    const rl = createCliPrompt();
    try {
      const settingsFile = await createGlobalSettingsWithWizard(
        resolveGlobalNdxDir(),
        {
          question: (prompt) => rl.question(prompt),
          print: (message) => console.error(message),
        },
      );
      console.error(`[config] installed ${settingsFile}`);
    } finally {
      rl.close();
    }
    return loadConfig(args.cwd);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingSettingsError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("missing ndx settings:")
  );
}

function mockConfig(cwd: string): NdxConfig {
  const globalDir = resolve(NDX_DEFAULTS.globalDir);
  const dataDir = resolve(globalDir, NDX_DEFAULTS.systemDir);
  return {
    model: "mock",
    modelPools: { session: ["mock"], worker: [], reviewer: [], custom: {} },
    instructions:
      "You are ndx, a local coding agent. Prefer concise plans, inspect before editing, and use shell when facts must be verified.",
    env: {},
    keys: {},
    maxTurns: NDX_DEFAULTS.maxTurns,
    shellTimeoutMs: NDX_DEFAULTS.shellTimeoutMs,
    providers: {
      mock: {
        type: "openai",
        key: "",
        url: NDX_DEFAULTS.mockProviderUrl,
      },
    },
    models: [
      {
        name: "mock",
        provider: "mock",
      },
    ],
    activeModel: {
      name: "mock",
      provider: "mock",
    },
    activeProvider: {
      type: "openai",
      key: "",
      url: NDX_DEFAULTS.mockProviderUrl,
    },
    permissions: {
      defaultMode: NDX_DEFAULTS.permissionMode,
    },
    websearch: {},
    search: {},
    mcp: {},
    globalMcp: {},
    projectMcp: {},
    plugins: [],
    tools: { imageGeneration: NDX_DEFAULTS.imageGenerationEnabled },
    paths: {
      globalDir,
      dataDir,
      sessionDir: dataDir,
      projectDir: cwd,
      projectNdxDir: resolve(cwd, NDX_DEFAULTS.configDir),
    },
  };
}

async function runInteractive(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): Promise<void> {
  await withEmbeddedServer(options, async (client) => {
    const rl = createCliPrompt();
    const session = new CliSessionController({
      client,
      cwd: options.args.cwd,
      question: (prompt) => rl.question(prompt),
      loginStore: createLoginStore(),
    });
    await session.initialize();

    printInteractiveHeader(options.config);
    try {
      await selectInitialSession(session, rl);
      while (true) {
        const prompt = (await rl.question("ndx> ")).trim();
        if (prompt.length === 0) {
          if (session.shouldExit()) {
            break;
          }
          continue;
        }
        const command = await session.handleCommand(prompt);
        if (command.handled && command.shouldExit) {
          break;
        }
        if (command.handled) {
          continue;
        }
        await session.runPrompt(prompt);
        if (session.shouldExit()) {
          break;
        }
      }
    } finally {
      rl.close();
    }
  });
}

async function runServer(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): Promise<void> {
  let finishFromDashboardExit!: () => void;
  const dashboardExit = new Promise<void>((resolveExit) => {
    finishFromDashboardExit = resolveExit;
  });
  const server = createSessionServer(options, finishFromDashboardExit);
  printWelcomeLogo();
  const address = await listen(
    server,
    options.args.listen,
    options.args.dashboardListen,
  );
  console.error(`[session-server] ${address.url}`);
  if (address.dashboardUrl !== undefined) {
    console.error(`[dashboard] ${address.dashboardUrl}`);
  }
  await Promise.race([waitForShutdown(), dashboardExit]);
  await server.close();
}

async function runConnected(options: {
  args: CliArgs;
  prompt: string;
}): Promise<void> {
  const url = options.args.connectUrl;
  if (url === undefined) {
    throw new Error("--connect requires a WebSocket URL");
  }
  const client = await SessionClient.connect(url);
  try {
    const session = new CliSessionController({
      client,
      cwd: options.args.cwd,
      loginStore: createLoginStore(),
    });
    await session.initialize();
    await session.startSession();
    await session.runPrompt(options.prompt);
  } finally {
    client.close();
  }
}

async function runManagedWorkspace(args: CliArgs): Promise<void> {
  const rl =
    args.interactive && process.stdin.isTTY ? createCliPrompt() : undefined;
  try {
    const state = await ensureManagedServer({
      cwd: args.cwd,
      serverUrl: args.serverUrl,
      print: (message) => console.error(message),
    });
    let socketUrl = state.socketUrl;
    if (!state.reachable) {
      await loadConfigForCli(args);
      socketUrl = await startDetachedManagedServer(args, state.socketUrl);
      console.error(`[session-server] ${socketUrl}`);
      console.error(`[dashboard] ${state.dashboardUrl}`);
    }
    const client = await SessionClient.connect(socketUrl);
    try {
      const session = new CliSessionController({
        client,
        cwd: args.cwd,
        loginStore: createLoginStore(),
        question:
          rl === undefined ? undefined : (prompt) => rl.question(prompt),
      });
      await session.initialize();
      if (args.interactive) {
        await selectInitialSession(session, requireReadline(rl));
        while (true) {
          const prompt = (await requireReadline(rl).question("ndx> ")).trim();
          if (prompt.length === 0) {
            if (session.shouldExit()) {
              break;
            }
            continue;
          }
          const command = await session.handleCommand(prompt);
          if (command.handled && command.shouldExit) {
            break;
          }
          if (command.handled) {
            continue;
          }
          await session.runPrompt(prompt);
        }
        return;
      }
      await session.startSession();
      await session.runPrompt(args.prompt ?? readStdin());
    } finally {
      client.close();
    }
  } finally {
    rl?.close();
  }
}

async function startDetachedManagedServer(
  args: CliArgs,
  socketUrl: string,
): Promise<string> {
  const configuredDashboardPort = process.env.NDX_DASHBOARD_PORT;
  const dashboardPort = String(
    configuredDashboardPort !== undefined &&
      Number.isInteger(Number(configuredDashboardPort))
      ? Number(configuredDashboardPort)
      : NDX_DEFAULTS.dashboardPort,
  );
  const launch = detachedManagedServerLaunch({
    cwd: args.cwd,
    entrypoint: fileURLToPath(import.meta.url),
    socketUrl,
    dashboardPort,
  });
  console.error(
    `[server] detached launch selected: ${launch.diagnostic.launcher}`,
  );
  console.error(`[server] detached cwd: ${launch.cwd}`);
  console.error(`[server] detached command: ${launch.command}`);
  console.error(`[server] detached exec: ${launch.diagnostic.execPath}`);
  console.error(
    `[server] detached server args: ${launch.diagnostic.serverArgs.join(" ")}`,
  );
  if (launch.diagnostic.logPaths.length > 0) {
    console.error(
      `[server] detached diagnostic logs: ${launch.diagnostic.logPaths.join(
        ", ",
      )}`,
    );
  }
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: launch.detached,
    stdio: "ignore",
    windowsHide: launch.windowsHide,
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error("failed to start detached ndx server process");
  }
  console.error(`[server] detached process spawned: pid=${child.pid}`);
  await waitForManagedServer(socketUrl);
  return socketUrl;
}

async function waitForManagedServer(socketUrl: string): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 10_000;
  let attempts = 0;
  let lastLogAt = 0;
  let lastProbe: Awaited<ReturnType<typeof probeManagedServer>> | undefined =
    undefined;
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    const probe = await probeManagedServer(socketUrl);
    lastProbe = probe;
    if (probe.reachable) {
      console.error(
        `[server] detached server reachable after ${Date.now() - startedAt}ms (${attempts} probes)`,
      );
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (attempts === 1 || elapsed - lastLogAt >= 1_000) {
      console.error(
        `[server] waiting for detached server: elapsed=${elapsed}ms attempt=${attempts} stage=${probe.stage}${
          probe.error === undefined ? "" : ` error=${probe.error}`
        }`,
      );
      lastLogAt = elapsed;
    }
    await delay(100);
  }
  throw new Error(
    `timed out waiting for detached ndx server: ${socketUrl}; attempts=${attempts}; lastStage=${lastProbe?.stage ?? "none"}${
      lastProbe?.error === undefined ? "" : `; lastError=${lastProbe.error}`
    }`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function selectInitialSession(
  session: CliSessionController,
  rl: CliPrompt,
): Promise<void> {
  const sessions = await session.listSessions();
  console.log(session.formatSessionChoices(sessions));
  while (true) {
    const answer = (await rl.question("session> ")).trim();
    const selector = answer.length === 0 ? "0" : answer;
    if (selector === "0") {
      await session.startSession();
      return;
    }
    if (sessions.some((entry) => String(entry.number) === selector)) {
      await session.restoreSession(selector);
      return;
    }
    console.log("choose 0 for a new session or a listed session number");
  }
}

async function withEmbeddedServer(
  options: { args: CliArgs; config: NdxConfig; sources: string[] },
  fn: (client: SessionClient) => Promise<void>,
): Promise<void> {
  const server = createSessionServer(options);
  printWelcomeLogo();
  const address = await server.listen(0, NDX_DEFAULTS.host);
  const client = await SessionClient.connect(address.url);
  try {
    await fn(client);
  } finally {
    client.close();
    await server.close();
  }
}

function createSessionServer(
  options: {
    args: CliArgs;
    config: NdxConfig;
    sources: string[];
  },
  onDashboardExit?: () => void,
): SessionServer {
  return new SessionServer({
    cwd: options.args.cwd,
    config: options.config,
    sources: options.sources,
    createClient: (config) => createClient(options.args.mock, config),
    requireDockerSandbox:
      !options.args.mock && process.env.NDX_REQUIRE_DOCKER_SANDBOX !== "0",
    packageVersion: readPackageVersion(),
    onDashboardExit,
  });
}

function shouldUseManagedWorkspace(args: CliArgs): boolean {
  return (
    args.mode === "run" && !args.mock && process.env.NDX_EMBEDDED_SERVER !== "1"
  );
}

function requireReadline(rl: CliPrompt | undefined): CliPrompt {
  if (rl === undefined) {
    throw new Error("interactive CLI setup requires a TTY");
  }
  return rl;
}

function createCliPrompt(): CliPrompt {
  const rl = createInterface({ input, terminal: false });
  return {
    question: async (prompt: string) => {
      output.write(prompt);
      return rl.question("");
    },
    close: () => rl.close(),
  };
}

async function listen(
  server: SessionServer,
  listenAddress: string,
  dashboardListenAddress: string,
): Promise<SessionServerAddress> {
  const socket = parseListenAddress(listenAddress, "--listen");
  const dashboard = parseListenAddress(
    dashboardListenAddress,
    "--dashboard-listen",
  );
  return server.listen(
    socket.port,
    socket.host,
    dashboard.port,
    dashboard.host,
  );
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

function createClient(mock: boolean, config: NdxConfig): ModelClient {
  return mock ? new MockModelClient() : createRoutedModelClient(config);
}

function parseArgs(argv: string[], invokedAsServer = false): CliArgs {
  let cwd = process.cwd();
  let mock = false;
  let help = false;
  let version = false;
  let mode: CliArgs["mode"] = invokedAsServer ? "serve" : "run";
  let listenAddress = `${NDX_DEFAULTS.host}:0`;
  let dashboardListenAddress = `${NDX_DEFAULTS.host}:0`;
  let connectUrl: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "serve" && positional.length === 0) {
      mode = "serve";
    } else if (arg === "--cwd") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--cwd requires a path");
      }
      cwd = resolve(next);
    } else if (arg === "--listen") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--listen requires HOST:PORT");
      }
      listenAddress = next;
    } else if (arg === "--dashboard-listen") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--dashboard-listen requires HOST:PORT");
      }
      dashboardListenAddress = next;
    } else if (arg === "--connect") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--connect requires a WebSocket URL");
      }
      mode = "connect";
      connectUrl = next;
    } else if (arg === "--mock") {
      mock = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-V") {
      version = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  const joinedPrompt = positional.join(" ").trim();
  const serverUrl =
    mode === "run" && !mock && positional.length > 0
      ? normalizeSocketUrl(positional[0])
      : undefined;
  if (mode === "run" && !mock && positional.length > 1) {
    throw new Error("ndx accepts at most one server address argument");
  }
  return {
    cwd,
    mock,
    mode,
    listen: listenAddress,
    dashboardListen: dashboardListenAddress,
    connectUrl,
    serverUrl,
    help,
    version,
    prompt:
      mode === "run" && !mock
        ? undefined
        : joinedPrompt.length > 0
          ? joinedPrompt
          : undefined,
    interactive: mode === "run" && !mock && process.stdin.isTTY,
  };
}

function readStdin(): string {
  return readFileSync(0, "utf8").trim();
}

function printInteractiveHeader(config: NdxConfig): void {
  console.log(
    `ndx\nmodel: ${config.model}\nChoose a session, then type a task and press Enter. Commands: /help, /exit\n`,
  );
}

function printHelp(): void {
  const globalSettings = `${NDX_DEFAULTS.containerGlobalDir}/${NDX_DEFAULTS.settingsFile}`;
  const searchRules = `${NDX_DEFAULTS.containerGlobalDir}/${NDX_DEFAULTS.searchFile}`;
  console.log(
    `ndx TypeScript agent\n\nUsage:\n  ndx [SERVER_ADDRESS]\n  ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]\n  ndxserver [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]\n  ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]\n  ndx --mock [--cwd PATH] [prompt]\n\nInteractive:\n  Run \`ndx\` from a TTY to connect to SERVER_ADDRESS, defaulting to ${NDX_DEFAULTS.host}:${NDX_DEFAULTS.socketPort}. If no server is reachable, ndx reports the miss, starts a local default server for the current folder, prints public server version/runtime/sandbox info, logs in, then shows session choices. Docker is used only as the server-managed tool sandbox.\n\nSession client:\n  The CLI prints the ndx logo, opens or attaches to a WebSocket session server, prints public server identity, logs in with account credentials, initializes the socket, starts or restores one session for the current folder, and exposes server commands such as /status, /init, /events, /session, /restoreSession, /deleteSession, and /interrupt.\n\nSession server:\n  The session server owns live session state, event broadcast, initialization detail, Docker sandbox preparation, and SQLite persistence. CLI clients display initialization detail but do not add it to model context.\n\nInteractive commands:\n${interactiveHelp()}\n\nSettings:\n  ${globalSettings}, then current project ${NDX_DEFAULTS.configDir}/${NDX_DEFAULTS.settingsFile}.\n  ${searchRules} contains web-search parsing rules.\n\nCommon fields:\n  { \"version\": \"${readPackageVersion()}\", \"model\": \"local-model\", \"providers\": {}, \"models\": [], \"keys\": {} }`,
  );
}

function parseListenAddress(
  listenAddress: string,
  optionName: string,
): { host: string; port: number } {
  const [host = NDX_DEFAULTS.host, portText = "0"] = listenAddress.split(":");
  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid ${optionName} port: ${listenAddress}`);
  }
  return { host, port };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
