#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { runAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { MockModelClient } from "./mock-client.js";
import { OpenAiResponsesClient } from "./openai.js";
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
    await runInteractive({ args, config });
    return;
  }

  const prompt = args.prompt ?? readStdin();
  const client = createClient(args.mock, config);
  await runPrompt(args.cwd, config, client, prompt);
}

async function runInteractive(options: {
  args: CliArgs;
  config: NdxConfig;
}): Promise<void> {
  const client = createClient(options.args.mock, options.config);
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
      await runPrompt(options.args.cwd, options.config, client, prompt);
    }
  } finally {
    rl.close();
  }
}

async function runPrompt(
  cwd: string,
  config: NdxConfig,
  client: ModelClient,
  prompt: string,
): Promise<void> {
  const text = await runAgent({
    cwd,
    config,
    client,
    prompt,
    onEvent(event) {
      if (event.type === "tool_call") {
        console.error(`[tool:${event.name}] ${event.arguments}`);
      }
      if (event.type === "tool_result") {
        console.error(`[tool:result] ${event.output}`);
      }
    },
  });
  if (text) {
    console.log(text);
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
    `ndx TypeScript agent\n\nUsage:\n  ndx [--mock] [--cwd PATH] [prompt]\n\nInteractive:\n  Run \`ndx\` without a prompt from a TTY to open the ndx prompt.\n\nConfig cascade:\n  /home/ndx/.ndx/config.toml, then every project .ndx/config.toml from root to cwd.\n\nCommon fields:\n  model = \"gpt-5\"\n  instructions = \"...\"\n  max_turns = 8\n  shell_timeout_ms = 120000\n\n  [env]\n  NAME = \"value\"`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
