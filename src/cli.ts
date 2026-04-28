#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { MockModelClient } from "./mock-client.js";
import { OpenAiResponsesClient } from "./openai.js";
import { SessionClient, type SessionNotification } from "./session-client.js";
import { SessionServer, type SessionServerAddress } from "./session-server.js";
import type { RuntimeEventMsg } from "./protocol.js";
import type { ModelClient, NdxConfig } from "./types.js";

interface CliArgs {
  cwd: string;
  mock: boolean;
  mode: "run" | "serve" | "connect";
  listen: string;
  connectUrl?: string;
  prompt?: string;
  interactive: boolean;
  help: boolean;
  version: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log("0.1.0");
    return;
  }

  const { config, sources } = loadConfig(args.cwd);
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
    const threadId = await startThread(client, args.cwd);
    await runRemotePrompt(client, threadId, prompt);
  });
}

async function runInteractive(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): Promise<void> {
  await withEmbeddedServer(options, async (client) => {
    const threadId = await startThread(client, options.args.cwd);
    const rl = createInterface({ input, output });

    printWelcome(options.config);
    try {
      while (true) {
        const prompt = (await rl.question("ndx> ")).trim();
        if (prompt.length === 0) {
          continue;
        }
        if (prompt === "/exit" || prompt === "/quit") {
          break;
        }
        if (prompt === "/help") {
          printInteractiveHelp();
          continue;
        }
        await runRemotePrompt(client, threadId, prompt);
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
  const address = await listen(server, options.args.listen);
  console.error(`[session-server] ${address.url}`);
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
    await client.request("initialize");
    const threadId = await startThread(client, options.args.cwd);
    await runRemotePrompt(client, threadId, options.prompt);
  } finally {
    client.close();
  }
}

async function withEmbeddedServer(
  options: { args: CliArgs; config: NdxConfig; sources: string[] },
  fn: (client: SessionClient) => Promise<void>,
): Promise<void> {
  const server = createSessionServer(options);
  const address = await server.listen(0, "127.0.0.1");
  const client = await SessionClient.connect(address.url);
  try {
    await client.request("initialize");
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
  return new SessionServer({
    cwd: options.args.cwd,
    config: options.config,
    sources: options.sources,
    createClient: () => createClient(options.args.mock, options.config),
  });
}

async function listen(
  server: SessionServer,
  listenAddress: string,
): Promise<SessionServerAddress> {
  const [host = "127.0.0.1", portText = "0"] = listenAddress.split(":");
  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid --listen port: ${listenAddress}`);
  }
  return server.listen(port, host);
}

async function startThread(
  client: SessionClient,
  cwd: string,
): Promise<string> {
  const response = await client.request<{ thread: { id: string } }>(
    "thread/start",
    { cwd },
  );
  return response.thread.id;
}

async function runRemotePrompt(
  client: SessionClient,
  threadId: string,
  prompt: string,
): Promise<void> {
  const completion = new Promise<string>((resolve, reject) => {
    const off = client.onNotification((notification) => {
      const msg = runtimeEvent(notification);
      if (msg?.type === "tool_call") {
        console.error(`[tool:${msg.name}] ${msg.arguments}`);
      } else if (msg?.type === "tool_result") {
        console.error(`[tool:result] ${msg.output}`);
      } else if (msg?.type === "turn_complete") {
        off();
        resolve(msg.finalText);
      } else if (msg?.type === "error") {
        off();
        reject(new Error(msg.message));
      }
    });
  });
  await client.request("turn/start", { threadId, prompt });
  const text = await completion;
  if (text) {
    console.log(text);
  }
}

function runtimeEvent(
  notification: SessionNotification,
): RuntimeEventMsg | undefined {
  if (notification.params === null || typeof notification.params !== "object") {
    return undefined;
  }
  const event = (notification.params as { event?: unknown }).event;
  if (event === null || typeof event !== "object") {
    return undefined;
  }
  return event as RuntimeEventMsg;
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

function createClient(mock: boolean, config: NdxConfig): ModelClient {
  return mock ? new MockModelClient() : new OpenAiResponsesClient(config);
}

function parseArgs(argv: string[]): CliArgs {
  let cwd = process.cwd();
  let mock = false;
  let help = false;
  let version = false;
  let mode: CliArgs["mode"] = "run";
  let listenAddress = "127.0.0.1:0";
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

function printWelcome(config: NdxConfig): void {
  console.log(
    `ndx\nmodel: ${config.model}\nType a task and press Enter. Commands: /help, /exit\n`,
  );
}

function printInteractiveHelp(): void {
  console.log(
    "Commands:\n  /help  Show this help\n  /exit  Leave ndx\n\nEverything else is sent to the agent.",
  );
}

function printHelp(): void {
  console.log(
    `ndx TypeScript agent\n\nUsage:\n  ndx [--mock] [--cwd PATH] [prompt]\n  ndx serve [--mock] [--cwd PATH] [--listen HOST:PORT]\n  ndx --connect ws://HOST:PORT [--cwd PATH] [prompt]\n\nInteractive:\n  Run \`ndx\` without a prompt from a TTY to open the ndx prompt.\n\nSession server:\n  The CLI sends thread and turn requests over WebSocket. The session server owns live thread state, event broadcast, and JSONL persistence.\n\nSettings:\n  /home/.ndx/settings.json, then nearest project .ndx/settings.json.\n  /home/.ndx/search.json contains web-search parsing rules.\n\nCommon fields:\n  { \"model\": \"qwen3.6-35b-a3b:tr\", \"providers\": {}, \"models\": [], \"keys\": {} }`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
