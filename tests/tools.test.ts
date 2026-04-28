import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { createToolRegistry } from "../src/tools/registry.js";
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
  plugins: [],
  tools: { imageGeneration: false },
};

test("registry exposes Rust Codex default local tools", () => {
  const registry = createToolRegistry(baseConfig);
  assert.deepEqual(
    registry
      .names()
      .filter((name) =>
        [
          "shell",
          "shell_command",
          "exec_command",
          "write_stdin",
          "update_plan",
          "request_user_input",
          "request_permissions",
          "apply_patch",
          "list_dir",
          "view_image",
          "list_mcp_resources",
          "list_mcp_resource_templates",
          "read_mcp_resource",
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
      "shell",
      "shell_command",
      "exec_command",
      "write_stdin",
      "update_plan",
      "request_user_input",
      "request_permissions",
      "apply_patch",
      "list_dir",
      "view_image",
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
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
      "tool_suggest",
      "tool_search",
    ],
  );
});

test("registry exposes configured MCP and plugin tools", () => {
  const registry = createToolRegistry({
    ...baseConfig,
    mcp: {
      memory: {
        tools: [
          {
            name: "create_entities",
            description: "Create memory graph entities.",
            inputSchema: {
              type: "object",
              properties: {
                entities: { type: "array" },
              },
            },
          },
        ],
      },
    },
    plugins: [
      {
        id: "calendar",
        namespace: "plugin__calendar__",
        tools: [
          {
            name: "create_event",
            description: "Create a calendar event.",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
              },
            },
          },
        ],
      },
    ],
  });

  assert.equal(registry.names().includes("mcp__memory__create_entities"), true);
  assert.equal(
    registry.names().includes("plugin__calendar__create_event"),
    true,
  );
});

test("parallel shell tool calls run in separate worker node processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ndx-parallel-tools-"));
  try {
    const result = await runAgent({
      cwd: root,
      config: baseConfig,
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
