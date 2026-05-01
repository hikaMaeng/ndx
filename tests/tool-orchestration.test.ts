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
import { runAgent, type AgentEvent } from "../src/agent/loop.js";
import { createToolRegistry } from "../src/session/tools/registry.js";
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
  maxTurns: 8,
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

const internalToolNames = [
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
] as const;

test("model-driven run exercises every configured tool and preserves scheduling contracts", async () => {
  const fixture = createToolFixture();
  const events: AgentEvent[] = [];
  try {
    const registry = await createToolRegistry(fixture.config);
    const expectedTools = registry.names();
    const result = await runAgent({
      cwd: fixture.root,
      config: fixture.config,
      client: new AllToolsModelClient(expectedTools),
      prompt: "exercise every tool",
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(result, "all tools exercised");
    const usedTools = events
      .filter((event) => event.type === "tool_call")
      .map((event) => event.name);
    assert.deepEqual([...usedTools].sort(), [...expectedTools].sort());

    const log = readToolLog(fixture.logPath);
    const parallelA = requireLog(log, "parallel_a");
    const parallelB = requireLog(log, "parallel_b");
    const serialFirst = requireLog(log, "serial_first");
    const serialSecond = requireLog(log, "serial_second");
    assert.equal(parallelA.ppid === parallelB.ppid, false);
    assert.equal(rangesOverlap(parallelA, parallelB), true);
    assert.equal(
      serialFirst.start >= Math.max(parallelA.end, parallelB.end),
      true,
    );
    assert.equal(serialSecond.start >= serialFirst.end, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("each configured tool executes directly without the agent loop", async () => {
  const fixture = createToolFixture();
  try {
    const registry = await createToolRegistry(fixture.config);
    for (const name of registry.names()) {
      const result = await registry.execute(
        name,
        directArgsForTool(name),
        toolContext(fixture),
      );
      assert.equal(typeof result.output, "string");
      assert.notEqual(result.output.length, 0);

      if (
        internalToolNames.includes(name as (typeof internalToolNames)[number])
      ) {
        assertInternalToolResult(name, result.output);
      }
      if (name === "direct_echo") {
        const payload = JSON.parse(result.output) as { stdout: string };
        assert.match(payload.stdout, /direct-ok/);
      }
      if (name === "mcp__probe__mcp_echo") {
        assert.deepEqual(JSON.parse(result.output), {
          content: [{ type: "text", text: "mcp:direct-mcp" }],
          isError: false,
        });
      }
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

interface ToolFixture {
  root: string;
  logPath: string;
  config: NdxConfig;
}

interface ToolLogEntry {
  tool: string;
  start: number;
  end: number;
  pid: number;
  ppid: number;
}

function createToolFixture(): ToolFixture {
  const root = mkdtempSync(join(tmpdir(), "ndx-tool-orchestration-"));
  const globalDir = join(root, "home", ".ndx");
  const projectNdxDir = join(root, "repo", ".ndx");
  const logPath = join(root, "tool-log.jsonl");
  writeTimedTool(join(globalDir, "system", "core", "tools", "parallel_a"), logPath, 160);
  writeTimedTool(join(globalDir, "system", "core", "tools", "parallel_b"), logPath, 160);
  writeTimedTool(join(globalDir, "system", "core", "tools", "serial_first"), logPath, 20);
  writeTimedTool(
    join(globalDir, "system", "core", "tools", "serial_second"),
    logPath,
    20,
  );
  writeEchoTool(join(globalDir, "system", "core", "tools", "direct_echo"));
  const mcpServerPath = join(root, "mcp-server.mjs");
  writeMcpServer(mcpServerPath);
  const mcpServer = {
    command: process.execPath,
    args: [mcpServerPath],
  };

  return {
    root,
    logPath,
    config: {
      ...baseConfig,
      mcp: { probe: mcpServer },
      projectMcp: { probe: mcpServer },
      paths: {
        globalDir,
        projectDir: join(root, "repo"),
        projectNdxDir,
      },
    },
  };
}

function writeTimedTool(
  toolDir: string,
  logPath: string,
  delayMs: number,
): void {
  mkdirSync(toolDir, { recursive: true });
  const name = toolDir.split("/").at(-1) ?? "unknown";
  writeFileSync(
    join(toolDir, "tool.json"),
    `${JSON.stringify(
      {
        type: "function",
        function: {
          name,
          description: "Record timing and process identity.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        command: process.execPath,
        args: ["tool.mjs"],
        env: { NDX_TEST_LOG: logPath, NDX_TEST_DELAY_MS: String(delayMs) },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    [
      'import { appendFileSync } from "node:fs";',
      `const tool = ${JSON.stringify(name)};`,
      "const start = Date.now();",
      "await new Promise((resolve) => setTimeout(resolve, Number(process.env.NDX_TEST_DELAY_MS ?? 0)));",
      "const end = Date.now();",
      "appendFileSync(process.env.NDX_TEST_LOG, JSON.stringify({ tool, start, end, pid: process.pid, ppid: process.ppid }) + '\\n');",
      "console.log(JSON.stringify({ tool, start, end, pid: process.pid, ppid: process.ppid }));",
      "",
    ].join("\n"),
  );
}

function writeEchoTool(toolDir: string): void {
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "tool.json"),
    `${JSON.stringify(
      {
        type: "function",
        function: {
          name: "direct_echo",
          description: "Echo a value.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
        command: process.execPath,
        args: ["tool.mjs"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(toolDir, "tool.mjs"),
    [
      'import { stdin, stdout } from "node:process";',
      'let body = "";',
      'stdin.setEncoding("utf8");',
      'stdin.on("data", (chunk) => { body += chunk; });',
      'stdin.on("end", () => {',
      "  const request = JSON.parse(body);",
      "  stdout.write(String(request.arguments.value) + '\\n');",
      "});",
      "",
    ].join("\n"),
  );
}

function writeMcpServer(file: string): void {
  writeFileSync(
    file,
    [
      'import { stdin, stdout } from "node:process";',
      'let body = "";',
      'stdin.setEncoding("utf8");',
      'stdin.on("data", (chunk) => { body += chunk; });',
      'stdin.on("end", () => {',
      "  for (const line of body.trim().split(/\\r?\\n/)) {",
      "    if (line.length === 0) continue;",
      "    const request = JSON.parse(line);",
      "    if (request.id === undefined) continue;",
      "    if (request.method === 'initialize') {",
      "      stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'probe', version: '1' } } }) + '\\n');",
      "    } else if (request.method === 'tools/list') {",
      "      stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'mcp_echo', description: 'Echo through MCP.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] } }) + '\\n');",
      "    } else if (request.method === 'tools/call') {",
      "      stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `mcp:${request.params.arguments.value}` }], isError: false } }) + '\\n');",
      "    }",
      "  }",
      "});",
      "",
    ].join("\n"),
  );
}

function readToolLog(logPath: string): ToolLogEntry[] {
  return readFileSync(logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ToolLogEntry);
}

function requireLog(log: ToolLogEntry[], tool: string): ToolLogEntry {
  const entry = log.find((item) => item.tool === tool);
  assert.notEqual(entry, undefined);
  return entry as ToolLogEntry;
}

function rangesOverlap(left: ToolLogEntry, right: ToolLogEntry): boolean {
  return left.start < right.end && right.start < left.end;
}

function directArgsForTool(name: string): Record<string, unknown> {
  if (name === "update_plan") {
    return {
      explanation: "direct check",
      plan: [{ step: "verify", status: "completed" }],
    };
  }
  if (name === "spawn_agents_on_csv") {
    return { csv_path: "items.csv", instruction: "process {id}" };
  }
  if (name === "report_agent_job_result") {
    return { job_id: "job", item_id: "item", result: { ok: true } };
  }
  if (name === "request_user_input") {
    return {
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Choose one.",
          options: [{ label: "A", description: "first" }],
        },
      ],
    };
  }
  if (name === "direct_echo") {
    return { value: "direct-ok" };
  }
  if (name === "mcp__probe__mcp_echo") {
    return { value: "direct-mcp" };
  }
  return {};
}

function toolContext(fixture: ToolFixture): {
  cwd: string;
  config: NdxConfig;
  env: Record<string, string>;
  timeoutMs: number;
} {
  return {
    cwd: fixture.root,
    config: fixture.config,
    env: {},
    timeoutMs: 30_000,
  };
}

function assertInternalToolResult(name: string, output: string): void {
  const payload = JSON.parse(output) as { status?: string; plan?: unknown };
  if (name === "update_plan") {
    assert.deepEqual(payload.plan, [{ step: "verify", status: "completed" }]);
    return;
  }
  assert.equal(payload.status, "unavailable");
}

class AllToolsModelClient implements ModelClient {
  private step = 0;

  constructor(private readonly toolNames: string[]) {}

  async create(): Promise<ModelResponse> {
    this.step += 1;
    if (this.step === 1) {
      return this.response(["parallel_a", "parallel_b"]);
    }
    if (this.step === 2) {
      return this.response(["serial_first"]);
    }
    if (this.step === 3) {
      return this.response(["serial_second"]);
    }
    if (this.step === 4) {
      return this.response(
        this.toolNames.filter(
          (name) =>
            ![
              "parallel_a",
              "parallel_b",
              "serial_first",
              "serial_second",
            ].includes(name),
        ),
      );
    }
    return {
      text: "all tools exercised",
      toolCalls: [],
      raw: {},
    };
  }

  private response(names: string[]): ModelResponse {
    return {
      text: "",
      toolCalls: names.map((name) => ({
        callId: `call-${name}`,
        name,
        arguments: JSON.stringify(directArgsForTool(name)),
      })),
      raw: {},
    };
  }
}
