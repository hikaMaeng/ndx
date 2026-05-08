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
    controllerTool("spawn_agent", "Spawn a sub-agent for a well-scoped task.", {
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
    controllerTool("send_input", "Send a message to an existing agent.", {
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
    controllerTool(
      "send_message",
      "Send a string message to an existing agent without triggering a new turn.",
      {
        target: stringSchema("Relative or canonical task name to message."),
        message: stringSchema("Message text to queue on the target agent."),
      },
    ),
    controllerTool(
      "followup_task",
      "Send a string message to an existing non-root agent and trigger a turn in the target.",
      {
        target: stringSchema("Agent id or canonical task name to message."),
        message: stringSchema("Message text to send to the target agent."),
        interrupt: booleanSchema(
          "When true, stop the agent's current task and handle this immediately.",
        ),
      },
    ),
    controllerTool("resume_agent", "Resume a previously closed agent by id.", {
      id: stringSchema("Agent id to resume."),
    }),
    controllerTool("wait_agent", "Wait for agents to reach a final status.", {
      targets: arraySchema(stringSchema(), "Agent ids to wait on."),
      timeout_ms: integerSchema("Optional timeout in milliseconds."),
    }),
    controllerTool("close_agent", "Close an agent and any open descendants.", {
      target: stringSchema("Agent id to close."),
    }),
    controllerTool(
      "list_agents",
      "List live agents in the current root thread tree.",
      {
        path_prefix: stringSchema("Optional task-path prefix."),
      },
    ),
  ];
}

function controllerTool(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
): ToolDefinition {
  return {
    name,
    supportsParallelToolCalls: false,
    schema: functionTool(name, description, objectSchema(properties)),
    execute: async (args, context, signal) => {
      const controller = context.agentController;
      if (controller === undefined) {
        return {
          output: JSON.stringify({
            status: "unavailable",
            message: `${name} requires an agent controller in ToolContext.`,
          }),
        };
      }
      const result = await dispatch(name, controller, args, context, signal);
      return { output: JSON.stringify(result) };
    },
  };
}

async function dispatch(
  name: string,
  controller: NonNullable<
    Parameters<NonNullable<ToolDefinition["execute"]>>[1]["agentController"]
  >,
  args: Record<string, unknown>,
  context: Parameters<NonNullable<ToolDefinition["execute"]>>[1],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "spawn_agent":
      return await controller.spawnAgent(args, context, signal);
    case "send_input":
    case "send_message":
    case "followup_task":
      return await controller.sendInput(args, context, signal);
    case "resume_agent":
      return await controller.resumeAgent(args, context, signal);
    case "wait_agent":
      return await controller.waitAgent(args, context, signal);
    case "close_agent":
      return await controller.closeAgent(args, context);
    case "list_agents":
      return await controller.listAgents(args);
    default:
      return {
        status: "unsupported",
        message: `unknown collaboration tool ${name}`,
      };
  }
}
