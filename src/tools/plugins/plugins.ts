import { spawn } from "node:child_process";
import type { JsonObject, NdxConfig, PluginToolSettings } from "../../types.js";
import { functionTool } from "../schema.js";
import type { ToolDefinition } from "../types.js";

export function pluginToolDefinitions(config: NdxConfig): ToolDefinition[] {
  return config.plugins.flatMap((plugin) => {
    const namespace = plugin.namespace ?? `plugin__${plugin.id}__`;
    return (plugin.tools ?? []).map((tool) => {
      const exposedName = `${namespace}${tool.name}`;
      return {
        name: exposedName,
        supportsParallelToolCalls: false,
        schema: functionTool(
          exposedName,
          tool.description ??
            `Plugin tool ${tool.name} from ${plugin.name ?? plugin.id}.`,
          normalizeSchema(tool.inputSchema),
        ),
        execute: async (args) => ({
          output: JSON.stringify(await runPluginTool(tool, args)),
        }),
      } satisfies ToolDefinition;
    });
  });
}

async function runPluginTool(
  tool: PluginToolSettings,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool.command === undefined) {
    return {
      isError: true,
      content: `plugin tool ${tool.name} has no command configured`,
    };
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(tool.command ?? "", tool.args ?? [], {
      cwd: tool.cwd,
      env: {
        ...process.env,
        NDX_TOOL_ARGS: JSON.stringify(args),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function normalizeSchema(schema: JsonObject | undefined): JsonObject {
  if (schema === undefined) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  return {
    ...schema,
    type: schema.type ?? "object",
    properties:
      typeof schema.properties === "object" && schema.properties !== null
        ? schema.properties
        : {},
  };
}
