#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createLoginStore } from "./auth.js";
import { createProjectSettingsWithWizard } from "./settings-wizard.js";
import {
  CliSessionController,
  interactiveHelp,
  printWelcomeLogo,
} from "./session-client.js";
import { ensureWorkspaceServer } from "./workspace.js";
import { loadConfig } from "../config/index.js";
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
  prompt?: string;
  interactive: boolean;
  help: boolean;
  version: boolean;
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
    console.log("0.1.0");
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
    if (!isMissingSettingsError(error) || !process.stdin.isTTY) {
      throw error;
    }
    const rl = createInterface({ input, output });
    try {
      const settingsFile = await createProjectSettingsWithWizard(args.cwd, {
        question: (prompt) => rl.question(prompt),
        print: (message) => console.error(message),
      });
      console.error(`[config] installed ${settingsFile}`);
    } finally {
      rl.close();
    }
    return loadConfig(args.cwd);
  }
}

function isMissingSettingsError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("missing ndx settings:")
  );
}

async function runInteractive(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): Promise<void> {
  await withEmbeddedServer(options, async (client) => {
    const rl = createInterface({ input, output });
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
  const server = createSessionServer(options);
  const address = await listen(
    server,
    options.args.listen,
    options.args.dashboardListen,
  );
  console.error(`[session-server] ${address.url}`);
  if (address.dashboardUrl !== undefined) {
    console.error(`[dashboard] ${address.dashboardUrl}`);
  }
  await waitForShutdown();
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
    args.interactive && process.stdin.isTTY
      ? createInterface({ input, output })
      : undefined;
  try {
    const state = await ensureWorkspaceServer({
      cwd: args.cwd,
      question: rl === undefined ? undefined : (prompt) => rl.question(prompt),
      print: (message) => console.error(message),
    });
    const client = await SessionClient.connect(state.socketUrl);
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

async function selectInitialSession(
  session: CliSessionController,
  rl: ReturnType<typeof createInterface>,
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
  const address = await server.listen(0, "127.0.0.1");
  const client = await SessionClient.connect(address.url);
  try {
    await fn(client);
  } finally {
    client.close();
    await server.close();
  }
}

function createSessionServer(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): SessionServer {
  const providerClient = options.args.mock
    ? undefined
    : createRoutedModelClient(options.config);
  return new SessionServer({
    cwd: options.args.cwd,
    config: options.config,
    sources: options.sources,
    createClient: (config) =>
      providerClient ?? createClient(options.args.mock, config),
  });
}

function shouldUseManagedWorkspace(args: CliArgs): boolean {
  return (
    args.mode === "run" && !args.mock && process.env.NDX_EMBEDDED_SERVER !== "1"
  );
}

function requireReadline(
  rl: ReturnType<typeof createInterface> | undefined,
): ReturnType<typeof createInterface> {
  if (rl === undefined) {
    throw new Error("interactive workspace setup requires a TTY");
  }
  return rl;
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
  let listenAddress = "127.0.0.1:0";
  let dashboardListenAddress = "127.0.0.1:0";
  let connectUrl: string | undefined;
  const prompt: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "serve" && prompt.length === 0) {
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
      prompt.push(arg);
    }
  }

  const joinedPrompt = prompt.join(" ").trim();
  return {
    cwd,
    mock,
    mode,
    listen: listenAddress,
    dashboardListen: dashboardListenAddress,
    connectUrl,
    help,
    version,
    prompt: joinedPrompt.length > 0 ? joinedPrompt : undefined,
    interactive:
      mode === "run" && joinedPrompt.length === 0 && process.stdin.isTTY,
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
  console.log(
    `ndx TypeScript agent\n\nUsage:\n  ndx [--mock] [--cwd PATH] [prompt]\n  ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]\n  ndxserver [--mock] [--cwd PATH] [--listen HOST:PORT] [--dashboard-listen HOST:PORT]\n  ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]\n\nInteractive:\n  Run \`ndx\` without a prompt from a TTY to open the ndx prompt.\n\nSession client:\n  The CLI prints the ndx logo, opens or attaches to a WebSocket session server, initializes the socket, logs in with account credentials, starts or restores a session, and exposes server commands such as /status, /init, /events, /session, /restoreSession, /deleteSession, and /interrupt.\n\nSession server:\n  The session server owns live session state, event broadcast, initialization detail, and SQLite persistence. CLI clients display initialization detail but do not add it to model context.\n\nInteractive commands:\n${interactiveHelp()}\n\nSettings:\n  /home/.ndx/settings.json, then nearest project .ndx/settings.json.\n  /home/.ndx/search.json contains web-search parsing rules.\n\nCommon fields:\n  { \"model\": \"qwen3.6-35b-a3b:tr\", \"providers\": {}, \"models\": [], \"keys\": {} }`,
  );
}

function parseListenAddress(
  listenAddress: string,
  optionName: string,
): { host: string; port: number } {
  const [host = "127.0.0.1", portText = "0"] = listenAddress.split(":");
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
