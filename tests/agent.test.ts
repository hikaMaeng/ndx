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
  modelPools: { session: ["mock"], worker: [], reviewer: [], custom: {} },
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
    writeShellTool(join(globalDir, "system", "tools", "shell"));
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

test("agent sends full client-side context after tool calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-context-stack-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    writeShellTool(join(globalDir, "system", "tools", "shell"));
    const client = new CapturingToolLoopClient();

    const result = await runAgent({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      client,
      prompt: "run pwd",
    });

    assert.equal(result, "done");
    assert.equal(client.inputs.length, 2);
    assert.deepEqual(client.inputs[1], [
      { type: "message", role: "user", content: "run pwd" },
      {
        type: "assistant_tool_calls",
        toolCalls: [
          {
            callId: "call-1",
            name: "shell",
            arguments: '{"command":"pwd"}',
          },
        ],
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: client.inputs[1][2]?.output,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent injects explicitly mentioned skill content before the user prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-skill-"));
  try {
    const skillPath = writeSkill(root, "repo-skill", "Repo skill body.");
    const client = new SkillCaptureClient();

    const result = await runAgent({
      cwd: root,
      config: {
        ...baseConfig,
        skills: {
          skills: [
            {
              name: "repo-skill",
              description: "Repo skill",
              path: skillPath,
              scope: "repo",
            },
          ],
          roots: [root],
          errors: [],
        },
      },
      client,
      prompt: "$repo-skill perform the task",
    });

    assert.equal(result, "done");
    assert.equal(client.inputs.length, 1);
    assert.deepEqual(client.inputs[0], [
      {
        type: "message",
        role: "user",
        content: [
          "# Skill: repo-skill",
          "",
          `<SKILL path="${skillPath}">`,
          "---",
          "name: repo-skill",
          "description: test skill",
          "---",
          "",
          "Repo skill body.",
          "</SKILL>",
        ].join("\n"),
      },
      {
        type: "message",
        role: "user",
        content: "$repo-skill perform the task",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent injects linked skill paths once and ignores ambiguous plain names", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-agent-skill-dedup-"));
  try {
    const firstSkill = writeSkill(join(root, "one"), "shared", "First body.");
    const secondSkill = writeSkill(join(root, "two"), "shared", "Second body.");
    const client = new SkillCaptureClient();

    await runAgent({
      cwd: root,
      config: {
        ...baseConfig,
        skills: {
          skills: [
            {
              name: "shared",
              description: "first",
              path: firstSkill,
              scope: "repo",
            },
            {
              name: "shared",
              description: "second",
              path: secondSkill,
              scope: "user",
            },
          ],
          roots: [root],
          errors: [],
        },
      },
      client,
      prompt: `[$shared](${firstSkill}) [$shared](${firstSkill}) $shared`,
    });

    assert.equal(client.inputs.length, 1);
    assert.deepEqual(
      (client.inputs[0] as Array<{ content?: string }>).map(
        (item) => item.content,
      ),
      [
        [
          "# Skill: shared",
          "",
          `<SKILL path="${firstSkill}">`,
          "---",
          "name: shared",
          "description: test skill",
          "---",
          "",
          "First body.",
          "</SKILL>",
        ].join("\n"),
        `[$shared](${firstSkill}) [$shared](${firstSkill}) $shared`,
      ],
    );
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
      join(globalDir, "system", "tools", "slow_tool"),
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
      "process.once('SIGTERM', () => {",
      "  writeFileSync(abortedPath, 'aborted');",
      "  process.exit(0);",
      "});",
      "writeFileSync(readyPath, 'ready');",
      "setInterval(() => {}, 1_000);",
      "",
    ].join("\n"),
  );
}

function writeSkill(root: string, name: string, body: string): string {
  const skillDir = root.endsWith(name) ? root : join(root, name);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(
    skillPath,
    [
      "---",
      `name: ${name}`,
      "description: test skill",
      "---",
      "",
      body,
      "",
    ].join("\n"),
  );
  return skillPath;
}

async function waitForFile(path: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

class SkillCaptureClient implements ModelClient {
  readonly inputs: unknown[] = [];

  async create(input: unknown): Promise<ModelResponse> {
    this.inputs.push(JSON.parse(JSON.stringify(input)) as unknown);
    return {
      text: "done",
      toolCalls: [],
      raw: {},
    };
  }
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

class CapturingToolLoopClient implements ModelClient {
  readonly inputs: Array<Array<Record<string, unknown>>> = [];

  async create(input: unknown): Promise<ModelResponse> {
    this.inputs.push(
      JSON.parse(JSON.stringify(input)) as Array<Record<string, unknown>>,
    );
    if (this.inputs.length === 1) {
      return {
        text: "",
        toolCalls: [
          {
            callId: "call-1",
            name: "shell",
            arguments: '{"command":"pwd"}',
          },
        ],
        raw: {},
      };
    }
    return {
      text: "done",
      toolCalls: [],
      raw: {},
    };
  }
}
