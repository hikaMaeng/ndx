import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { isAgentAbortError } from "../src/abort.js";
import { runAgent } from "../src/agent.js";
import { MockModelClient } from "../src/mock-client.js";
import type { ModelClient, ModelResponse, NdxConfig } from "../src/types.js";

const baseConfig: NdxConfig = {
  model: "mock",
  instructions: "test",
  env: {},
  keys: {},
  maxTurns: 4,
  shellTimeoutMs: 30_000,
  providers: {
    mock: {
      type: "openai",
      key: "",
      url: "http://localhost/v1",
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
    url: "http://localhost/v1",
  },
  permissions: {
    defaultMode: "danger-full-access",
  },
  websearch: {},
  search: {},
  mcp: {},
  globalMcp: {},
  projectMcp: {},
  plugins: [],
  tools: { imageGeneration: false },
  paths: {
    globalDir: "/home/.ndx",
  },
};

test("mock agent exercises shell tool and completes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    const target = join(root, "tmp", "verify.txt");
    const result = await runAgent({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      client: new MockModelClient(),
      prompt: `create a file named ${target} with text verified`,
    });
    assert.equal(result, "mock agent completed");
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, "utf8"), "verified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent abort signal stops before starting a model request", async () => {
  const client = new CountingModelClient();
  const controller = new AbortController();
  controller.abort("user requested stop");

  await assert.rejects(
    runAgent({
      cwd: process.cwd(),
      config: baseConfig,
      client,
      prompt: "do not start",
      signal: controller.signal,
    }),
    isAgentAbortError,
  );
  assert.equal(client.requests, 0);
});

function writeShellTool(toolDir: string): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    JSON.stringify({
      type: "function",
      function: {
        name: "shell",
        description: "Run a shell command.",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
          additionalProperties: false,
        },
      },
      command: "node",
      args: ["tool.mjs"],
    }),
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { stdin, stdout } from "node:process";',
      'let body = "";',
      'stdin.setEncoding("utf8");',
      'stdin.on("data", (chunk) => { body += chunk; });',
      'stdin.on("end", () => {',
      "  const request = JSON.parse(body);",
      '  const child = spawn("/bin/bash", ["-lc", request.arguments.command], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"] });',
      '  let out = "";',
      '  let err = "";',
      '  child.stdout.setEncoding("utf8");',
      '  child.stderr.setEncoding("utf8");',
      '  child.stdout.on("data", (chunk) => { out += chunk; });',
      '  child.stderr.on("data", (chunk) => { err += chunk; });',
      '  child.on("close", (exitCode) => stdout.write(JSON.stringify({ exitCode, stdout: out, stderr: err }) + "\\n"));',
      "});",
      "",
    ].join("\n"),
  );
}

class CountingModelClient implements ModelClient {
  requests = 0;

  async create(): Promise<ModelResponse> {
    this.requests += 1;
    return {
      text: "unused",
      toolCalls: [],
      raw: {},
    };
  }
}
