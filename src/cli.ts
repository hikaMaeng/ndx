#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { MockModelClient } from "./mock-client.js";
import { OpenAiResponsesClient } from "./openai.js";

interface CliArgs {
  cwd: string;
  mock: boolean;
  prompt: string;
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
  const client = args.mock
    ? new MockModelClient()
    : new OpenAiResponsesClient(config);
  const text = await runAgent({
    cwd: args.cwd,
    config,
    client,
    prompt: args.prompt,
    onEvent(event) {
      if (event.type === "tool_call") {
        console.error(`[tool:${event.name}] ${event.arguments}`);
      }
      if (event.type === "tool_result") {
        console.error(`[tool:result] ${event.output}`);
      }
    },
  });
  if (sources.length > 0) {
    console.error(`[config] ${sources.join(", ")}`);
  }
  if (text) {
    console.log(text);
  }
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

  return { cwd, mock, help, version, prompt: prompt.join(" ") || readStdin() };
}

function readStdin(): string {
  if (process.stdin.isTTY) {
    return "Inspect the workspace.";
  }
  return readFileSync(0, "utf8").trim();
}

function printHelp(): void {
  console.log(
    `ndx TypeScript agent\n\nUsage:\n  ndx [--mock] [--cwd PATH] <prompt>\n\nConfig cascade:\n  /home/ndx/.ndx/config.toml, then every project .ndx/config.toml from root to cwd.\n\nCommon fields:\n  model = \"gpt-5\"\n  instructions = \"...\"\n  max_turns = 8\n  shell_timeout_ms = 120000\n\n  [env]\n  NAME = \"value\"`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
