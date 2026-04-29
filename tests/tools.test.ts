import {
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
import { runAgent } from "../src/agent/loop.js";
import { ensureGlobalNdxHome } from "../src/config/index.js";
import { createToolRegistry } from "../src/session/tools/registry.js";
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
    globalDir: "/tmp/ndx-empty-global",
  },
};

test("registry exposes internal task tools only from the agent body", async () => {
  const registry = await createToolRegistry(baseConfig);
  assert.deepEqual(
    registry
      .names()
      .filter((name) =>
        [
          "update_plan",
          "request_user_input",
          "spawn_agent",
          "send_input",
          "resume_agent",
          "wait_agent",
          "close_agent",
          "send_message",
          "followup_task",
          "list_agents",
          "spawn_agents_on_csv",
          "report_agent_job_result",
          "tool_suggest",
          "tool_search",
        ].includes(name),
      ),
    [
      "update_plan",
      "request_user_input",
      "spawn_agent",
      "send_input",
      "send_message",
      "followup_task",
      "resume_agent",
      "wait_agent",
      "close_agent",
      "list_agents",
      "spawn_agents_on_csv",
      "report_agent_job_result",
    ],
  );
});

test("registry discovers tool.json layers and keeps higher priority names", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-tool-layers-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    const projectNdxDir = join(root, "repo", ".ndx");
    writeEchoTool(join(globalDir, "core", "tools", "echo"), "core");
    writeEchoTool(join(projectNdxDir, "tools", "echo"), "project");
    writeEchoTool(
      join(projectNdxDir, "plugins", "calendar", "tools", "calendar_event"),
      "project-plugin",
    );
    const registry = await createToolRegistry({
      ...baseConfig,
      paths: {
        globalDir,
        projectDir: join(root, "repo"),
        projectNdxDir,
      },
    });

    assert.equal(registry.names().includes("echo"), true);
    assert.equal(registry.names().includes("calendar_event"), true);
    assert.deepEqual(
      registry.metadata().filter((tool) => tool.name === "echo"),
      [{ name: "echo", layer: "core", kind: "external" }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry exposes bootstrapped core capability tools as external tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-core-tools-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    ensureGlobalNdxHome(globalDir);
    const registry = await createToolRegistry({
      ...baseConfig,
      paths: { globalDir },
    });

    for (const name of [
      "shell",
      "apply_patch",
      "list_dir",
      "view_image",
      "web_search",
      "image_generation",
      "tool_suggest",
      "tool_search",
      "request_permissions",
    ]) {
      assert.deepEqual(
        registry
          .metadata()
          .filter((tool) => tool.name === name)
          .map((tool) => ({ layer: tool.layer, kind: tool.kind })),
        [{ layer: "core", kind: "external" }],
      );
    }

    const context = {
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir },
      },
      env: {},
      timeoutMs: 30_000,
    };
    const listDir = await registry.execute(
      "list_dir",
      { dir_path: globalDir, limit: 5 },
      context,
    );
    assert.equal(
      parseExternalStdout(listDir.output).entries.some(
        (entry: { path: string }) => entry.path.endsWith("core"),
      ),
      true,
    );
    const toolSearch = await registry.execute(
      "tool_search",
      { query: "image", limit: 5 },
      context,
    );
    assert.equal(
      parseExternalStdout(toolSearch.output).tools.some(
        (tool: { name: string }) => tool.name === "view_image",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry exposes project MCP before global MCP", async () => {
  const registry = await createToolRegistry({
    ...baseConfig,
    projectMcp: {
      memory: {
        tools: [
          {
            name: "create_entities",
            description: "Create project memory graph entities.",
          },
        ],
      },
    },
    globalMcp: {
      memory: {
        tools: [
          {
            name: "create_entities",
            description: "Create global memory graph entities.",
          },
        ],
      },
    },
  });

  assert.deepEqual(
    registry
      .metadata()
      .filter((tool) => tool.name === "mcp__memory__create_entities"),
    [
      {
        name: "mcp__memory__create_entities",
        layer: "project-mcp",
        kind: "external",
      },
    ],
  );
});

test("parallel shell tool calls run in separate worker node processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-parallel-tools-"));
  try {
    const globalDir = join(root, "home", ".ndx");
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    const result = await runAgent({
      cwd: root,
      config: {
        ...baseConfig,
        paths: { globalDir },
      },
      client: new ParallelShellClient(),
      prompt: "run parallel tools",
    });
    assert.equal(result, "parallel complete");
    const firstParent = readFileSync(join(root, "first.ppid"), "utf8").trim();
    const secondParent = readFileSync(join(root, "second.ppid"), "utf8").trim();
    assert.notEqual(firstParent, secondParent);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeEchoTool(toolDir: string, value: string): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    `${JSON.stringify(
      {
        type: "function",
        function: {
          name: toolDir.split("/").at(-1),
          description: "Echo test tool.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        command: "node",
        args: ["tool.mjs"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    `console.log(${JSON.stringify(value)});\n`,
  );
}

function parseExternalStdout(output: string): Record<string, any> {
  const wrapped = JSON.parse(output) as { stdout: string };
  return JSON.parse(wrapped.stdout) as Record<string, any>;
}

function writeShellTool(toolDir: string): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { stdin, stdout } from "node:process";',
      'let body = "";',
      'stdin.setEncoding("utf8");',
      'stdin.on("data", (chunk) => { body += chunk; });',
      'stdin.on("end", async () => {',
      "  const request = JSON.parse(body);",
      "  const command = request.arguments.command;",
      '  const child = spawn("/bin/bash", ["-lc", command], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"] });',
      '  let out = "";',
      '  let err = "";',
      '  child.stdout.setEncoding("utf8");',
      '  child.stderr.setEncoding("utf8");',
      '  child.stdout.on("data", (chunk) => { out += chunk; });',
      '  child.stderr.on("data", (chunk) => { err += chunk; });',
      '  child.on("close", (exitCode) => { stdout.write(JSON.stringify({ exitCode, stdout: out, stderr: err }) + "\\n"); });',
      "});",
      "",
    ].join("\n"),
  );
}

class ParallelShellClient implements ModelClient {
  private step = 0;

  async create(): Promise<ModelResponse> {
    if (this.step === 0) {
      this.step += 1;
      return {
        text: "",
        toolCalls: [
          {
            callId: "first",
            name: "shell",
            arguments: JSON.stringify({
              command: 'printf %s "$PPID" > first.ppid',
            }),
          },
          {
            callId: "second",
            name: "shell",
            arguments: JSON.stringify({
              command: 'printf %s "$PPID" > second.ppid',
            }),
          },
        ],
        raw: {},
      };
    }
    return {
      text: "parallel complete",
      toolCalls: [],
      raw: {},
    };
  }
}
