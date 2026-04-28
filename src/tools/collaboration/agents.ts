import {
  arraySchema,
  booleanSchema,
  functionTool,
  integerSchema,
  objectSchema,
  stringSchema,
} from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function collaborationTools(): ToolDefinition[] {
  return [
    placeholder("spawn_agent", "Spawn a sub-agent for a well-scoped task.", {
      message: stringSchema("Initial plain-text task for the new agent."),
      items: arraySchema(
        objectSchema({
          type: stringSchema(),
          text: stringSchema(),
          path: stringSchema(),
        }),
      ),
      agent_type: stringSchema("Optional type name for the new agent."),
      fork_context: booleanSchema(
        "When true, fork the current thread history.",
      ),
      model: stringSchema("Optional model override for the new agent."),
      reasoning_effort: stringSchema("Optional reasoning effort override."),
    }),
    placeholder("send_input", "Send a message to an existing agent.", {
      target: stringSchema("Agent id to message."),
      message: stringSchema("Plain-text message to send."),
      items: arraySchema(
        objectSchema({
          type: stringSchema(),
          text: stringSchema(),
          path: stringSchema(),
        }),
      ),
      interrupt: booleanSchema("When true, stop the agent's current task."),
    }),
    placeholder("resume_agent", "Resume a previously closed agent by id.", {
      id: stringSchema("Agent id to resume."),
    }),
    placeholder("wait_agent", "Wait for agents to reach a final status.", {
      targets: arraySchema(stringSchema(), "Agent ids to wait on."),
      timeout_ms: integerSchema("Optional timeout in milliseconds."),
    }),
    placeholder("close_agent", "Close an agent and any open descendants.", {
      target: stringSchema("Agent id to close."),
    }),
  ];
}

function placeholder(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
): ToolDefinition {
  return {
    name,
    supportsParallelToolCalls: false,
    schema: functionTool(name, description, objectSchema(properties)),
    execute: async () => ({
      output: JSON.stringify({
        status: "unavailable",
        message: `${name} requires the Rust Codex multi-agent runtime; no TypeScript backend is configured.`,
      }),
    }),
  };
}
