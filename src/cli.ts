#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { MockModelClient } from "./mock-client.js";
import { OpenAiResponsesClient } from "./openai.js";
import { AgentRuntime } from "./runtime.js";
import type { RuntimeEvent } from "./protocol.js";
import type { ModelClient, NdxConfig } from "./types.js";

interface CliArgs {
  cwd: string;
  mock: boolean;
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

  if (args.interactive) {
    await runInteractive({ args, config, sources });
    return;
  }

  const prompt = args.prompt ?? readStdin();
  const client = createClient(args.mock, config);
  const runtime = new AgentRuntime({
    cwd: args.cwd,
    config,
    client,
    sources,
  });
  await runPrompt(runtime, prompt);
}

async function runInteractive(options: {
  args: CliArgs;
  config: NdxConfig;
  sources: string[];
}): Promise<void> {
  const client = createClient(options.args.mock, options.config);
  const runtime = new AgentRuntime({
    cwd: options.args.cwd,
    config: options.config,
    client,
    sources: options.sources,
  });
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
      await runPrompt(runtime, prompt);
    }
  } finally {
    rl.close();
  }
}

async function runPrompt(runtime: AgentRuntime, prompt: string): Promise<void> {
  const text = await runtime.runPrompt(prompt, printRuntimeEvent);
  if (text) {
    console.log(text);
  }
}

function printRuntimeEvent(event: RuntimeEvent): void {
  const msg = event.msg;
  if (msg.type === "tool_call") {
    console.error(`[tool:${msg.name}] ${msg.arguments}`);
  }
  if (msg.type === "tool_result") {
    console.error(`[tool:result] ${msg.output}`);
  }
}

function createClient(mock: boolean, config: NdxConfig): ModelClient {
  return mock ? new MockModelClient() : new OpenAiResponsesClient(config);
}

function parseArgs(argv: string[]): CliArgs {
  let cwd = process.cwd();
  let mock = false;
  let help = false;
  let version = false;
  const prompt: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--cwd requires a path");
      }
      cwd = resolve(next);
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
    help,
    version,
    prompt: joinedPrompt.length > 0 ? joinedPrompt : undefined,
    interactive: joinedPrompt.length === 0 && process.stdin.isTTY,
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
    `ndx TypeScript agent\n\nUsage:\n  ndx [--mock] [--cwd PATH] [prompt]\n\nInteractive:\n  Run \`ndx\` without a prompt from a TTY to open the ndx prompt.\n\nSettings:\n  /home/.ndx/settings.json, then nearest project .ndx/settings.json.\n  /home/.ndx/search.json contains web-search parsing rules.\n\nCommon fields:\n  { \"model\": \"qwen3.6-35b-a3b:tr\", \"providers\": {}, \"models\": [], \"keys\": {} }`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
