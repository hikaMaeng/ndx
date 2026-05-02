import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NdxConfig } from "../../shared/types.js";
import { agentJobTools } from "./collaboration/agent-jobs.js";
import { collaborationTools } from "./collaboration/agents.js";
import { requestUserInputTool } from "./input/request-user-input.js";
import { mcpToolDefinitions } from "./mcp/tools.js";
import { updatePlanTool } from "./planning/update-plan.js";
import { discoverToolDirectory } from "./external/manifest.js";
import { runExternalTool } from "./external/runner.js";
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
  ToolSchema,
} from "./types.js";

export class ToolRegistry {
  private readonly tools: ToolDefinition[];
  private readonly byName: Map<string, ToolDefinition>;

  private constructor(tools: ToolDefinition[]) {
    this.tools = tools;
    this.byName = new Map(this.tools.map((tool) => [tool.name, tool]));
  }

  static async create(config: NdxConfig): Promise<ToolRegistry> {
    const ordered: ToolDefinition[] = [];
    addLayer(ordered, taskTools(), "task");
    addLayer(
      ordered,
      discoverToolDirectory(coreToolsDir(config), "core"),
      "core",
    );
    addLayer(
      ordered,
      discoverToolDirectory(projectToolsDir(config), "project"),
      "project",
    );
    addLayer(
      ordered,
      discoverToolDirectory(globalToolsDir(config), "global"),
      "global",
    );
    addLayer(
      ordered,
      discoverPluginTools(projectPluginsDir(config), "project-plugin"),
      "project-plugin",
    );
    addLayer(
      ordered,
      discoverPluginTools(globalPluginsDir(config), "global-plugin"),
      "global-plugin",
    );
    addLayer(
      ordered,
      await mcpToolDefinitions(config, config.projectMcp, "project-mcp"),
      "project-mcp",
    );
    addLayer(
      ordered,
      await mcpToolDefinitions(config, config.globalMcp, "global-mcp"),
      "global-mcp",
    );
    return new ToolRegistry(ordered);
  }

  schemas(): ToolSchema[] {
    return this.tools.map((tool) => tool.schema);
  }

  names(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  metadata(): Array<{ name: string; layer: string; kind: string }> {
    return this.tools.map((tool) => ({
      name: tool.name,
      layer: tool.layer ?? "unknown",
      kind: tool.kind ?? "task",
    }));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const tool = this.byName.get(name);
    if (tool === undefined) {
      return { output: `unsupported tool: ${name}` };
    }
    if (tool.kind === "external" && tool.runtime !== undefined) {
      return await runExternalTool(tool.runtime, args, context, signal);
    }
    if (tool.execute !== undefined) {
      return await tool.execute(args, context, signal);
    }
    return { output: `tool ${name} has no executable runtime` };
  }
}

export async function createToolRegistry(
  config: NdxConfig,
): Promise<ToolRegistry> {
  return await ToolRegistry.create(config);
}

function taskTools(): ToolDefinition[] {
  return [
    markTask(updatePlanTool()),
    markTask(requestUserInputTool()),
    ...collaborationTools().map(markTask),
    ...agentJobTools().map(markTask),
  ];
}

function markTask(tool: ToolDefinition): ToolDefinition {
  return { ...tool, kind: "task", layer: "task" };
}

function addLayer(
  target: ToolDefinition[],
  tools: ToolDefinition[],
  layer: string,
): void {
  const existing = new Set(target.map((tool) => tool.name));
  for (const tool of tools) {
    if (!existing.has(tool.name)) {
      target.push({ ...tool, layer: tool.layer ?? layer });
      existing.add(tool.name);
    }
  }
}

function discoverPluginTools(
  pluginsDir: string | undefined,
  layer: string,
): ToolDefinition[] {
  if (pluginsDir === undefined || !existsSync(pluginsDir)) {
    return [];
  }
  return readdirSync(pluginsDir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? discoverToolDirectory(join(pluginsDir, entry.name, "tools"), layer)
      : [],
  );
}

function coreToolsDir(config: NdxConfig): string {
  return join(config.paths.globalDir, "system", "tools");
}

function projectToolsDir(config: NdxConfig): string {
  return config.paths.projectNdxDir === undefined
    ? join(config.paths.globalDir, ".missing-project-tools")
    : join(config.paths.projectNdxDir, "tools");
}

function globalToolsDir(config: NdxConfig): string {
  return join(config.paths.globalDir, "tools");
}

function projectPluginsDir(config: NdxConfig): string | undefined {
  return config.paths.projectNdxDir === undefined
    ? undefined
    : join(config.paths.projectNdxDir, "plugins");
}

function globalPluginsDir(config: NdxConfig): string {
  return join(config.paths.globalDir, "plugins");
}
