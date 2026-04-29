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
import { isAgentAbortError } from "../src/runtime/abort.js";
import { runAgent } from "../src/agent/loop.js";
import { MockModelClient } from "../src/model/mock-client.js";
import type {
  ModelClient,
  ModelResponse,
  NdxConfig,
} from "../src/shared/types.js";

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

test("agent abort signal propagates to external tool processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-abort-tool-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    const abortedPath = join(root, "tool-aborted.txt");
    const readyPath = join(root, "tool-ready.txt");
    writeAbortAwareTool(
      join(globalDir, "core", "tools", "slow_tool"),
      readyPath,
      abortedPath,
    );
    const controller = new AbortController();

    await assert.rejects(
      runAgent({
        cwd: root,
        config: { ...baseConfig, paths: { globalDir } },
        client: new SlowToolClient(),
        prompt: "start slow tool",
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "tool_call") {
            void waitForFile(readyPath).then(() => {
              controller.abort("stop slow tool");
            });
          }
        },
      }),
      isAgentAbortError,
    );

    assert.equal(await waitForFile(abortedPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

function writeAbortAwareTool(
  toolDir: string,
  readyPath: string,
  abortedPath: string,
): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    JSON.stringify({
      type: "function",
      function: {
        name: "slow_tool",
        description: "Wait until aborted.",
        parameters: {
          type: "object",
          properties: {},
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
      'import { writeFileSync } from "node:fs";',
      `const readyPath = ${JSON.stringify(readyPath)};`,
      `const abortedPath = ${JSON.stringify(abortedPath)};`,
      "writeFileSync(readyPath, 'ready');",
      "process.once('SIGTERM', () => {",
      "  writeFileSync(abortedPath, 'aborted');",
      "  process.exit(0);",
      "});",
      "setInterval(() => {}, 1_000);",
      "",
    ].join("\n"),
  );
}

async function waitForFile(path: string): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
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

class SlowToolClient implements ModelClient {
  private requests = 0;

  async create(): Promise<ModelResponse> {
    this.requests += 1;
    if (this.requests === 1) {
      return {
        text: "",
        toolCalls: [
          {
            callId: "slow-tool",
            name: "slow_tool",
            arguments: "{}",
          },
        ],
        raw: {},
      };
    }
    return {
      text: "unused",
      toolCalls: [],
      raw: {},
    };
  }
}
