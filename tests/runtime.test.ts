import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { classifyModelError } from "../src/errors.js";
import { MockModelClient } from "../src/mock-client.js";
import type { RuntimeEvent } from "../src/protocol.js";
import { AgentRuntime } from "../src/runtime.js";
import type { NdxConfig } from "../src/types.js";

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

test("runtime emits session, turn, tool, and completion events", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-runtime-"));
  const events: RuntimeEvent[] = [];
  try {
    const globalDir = join(root, "home", ".ndx");
    writeShellTool(join(globalDir, "core", "tools", "shell"));
    const runtime = new AgentRuntime({
      cwd: root,
      config: { ...baseConfig, paths: { globalDir } },
      client: new MockModelClient(),
      sources: ["/home/.ndx/settings.json"],
    });

    const finalText = await runtime.runPrompt("list files", (event) => {
      events.push(event);
    });

    assert.equal(finalText, "mock agent completed");
    assert.deepEqual(
      events.map((event) => event.msg.type),
      [
        "session_configured",
        "turn_started",
        "tool_call",
        "tool_result",
        "agent_message",
        "turn_complete",
      ],
    );
    assert.equal(events[0]?.msg.type, "session_configured");
    if (events[0]?.msg.type === "session_configured") {
      assert.equal(events[0].msg.model, "mock");
      assert.equal(events[0].msg.sources[0], "/home/.ndx/settings.json");
    }
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
    'import { stdout } from "node:process"; stdout.write(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }) + "\\n");\n',
  );
}

test("runtime interrupt emits turn_aborted", async () => {
  const events: RuntimeEvent[] = [];
  const runtime = new AgentRuntime({
    cwd: process.cwd(),
    config: baseConfig,
    client: new MockModelClient(),
  });

  await runtime.submit(
    {
      id: "interrupt-1",
      op: { type: "interrupt", reason: "user requested stop" },
    },
    (event) => {
      events.push(event);
    },
  );

  assert.deepEqual(
    events.map((event) => event.msg.type),
    ["session_configured", "turn_aborted"],
  );
  const abort = events[1]?.msg;
  assert.equal(abort?.type, "turn_aborted");
  if (abort?.type === "turn_aborted") {
    assert.equal(abort.reason, "user requested stop");
  }
});

test("model error classification separates retryable failures", () => {
  assert.deepEqual(classifyModelError(new Error("HTTP 401 unauthorized")), {
    code: "unauthorized",
    recoverable: false,
    message: "HTTP 401 unauthorized",
  });
  assert.deepEqual(classifyModelError(new Error("HTTP 429 rate limit")), {
    code: "rate_limited",
    recoverable: true,
    message: "HTTP 429 rate limit",
  });
  assert.deepEqual(classifyModelError(new Error("fetch failed ECONNREFUSED")), {
    code: "connection_failed",
    recoverable: true,
    message: "fetch failed ECONNREFUSED",
  });
});
