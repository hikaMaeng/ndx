import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/tools/registry.js";
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
      "resume_agent",
      "wait_agent",
      "close_agent",
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
