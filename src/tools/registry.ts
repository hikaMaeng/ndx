import type { NdxConfig } from "../types.js";
import { toolSearchTool } from "./discovery/tool-search.js";
import { toolSuggestTool } from "./discovery/tool-suggest.js";
import { listDirTool } from "./filesystem/list-dir.js";
import { viewImageTool } from "./filesystem/view-image.js";
import { requestUserInputTool } from "./input/request-user-input.js";
import {
  execCommandTool,
  shellCommandTool,
  shellTool,
  writeStdinTool,
} from "./local/shell.js";
import { imageGenerationTool } from "./media/image-generation.js";
import {
  listMcpResourceTemplatesTool,
  listMcpResourcesTool,
  readMcpResourceTool,
} from "./mcp/resources.js";
import { mcpToolDefinitions } from "./mcp/tools.js";
import { applyPatchTool } from "./patch/apply-patch.js";
import { requestPermissionsTool } from "./permissions/request-permissions.js";
import { updatePlanTool } from "./planning/update-plan.js";
import { pluginToolDefinitions } from "./plugins/plugins.js";
import { webSearchTool } from "./web/web-search.js";
import type { ToolContext, ToolDefinition, ToolExecutionResult, ToolSchema } from "./types.js";
import { collaborationTools } from "./collaboration/agents.js";

export class ToolRegistry {
  private readonly tools: ToolDefinition[];
  private readonly byName: Map<string, ToolDefinition>;

  constructor(config: NdxConfig) {
    const tools: ToolDefinition[] = [
      shellTool(),
      shellCommandTool(),
      execCommandTool(),
      writeStdinTool(),
      updatePlanTool(),
      requestUserInputTool(),
      requestPermissionsTool(),
      applyPatchTool(),
      listDirTool(),
      viewImageTool(),
      listMcpResourcesTool(),
      listMcpResourceTemplatesTool(),
      readMcpResourceTool(),
      ...collaborationTools(),
      ...mcpToolDefinitions(config),
      ...pluginToolDefinitions(config),
    ];
    if (config.websearch.provider !== undefined) {
      tools.push(webSearchTool());
    }
    if (config.tools.imageGeneration === true) {
      tools.push(imageGenerationTool());
    }
    tools.push(toolSuggestTool());
    tools.push(toolSearchTool(() => this.tools));

    this.tools = dedupeTools(tools);
    this.byName = new Map(this.tools.map((tool) => [tool.name, tool]));
  }

  schemas(): ToolSchema[] {
    return this.tools.map((tool) => tool.schema);
  }

  names(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.byName.get(name);
    if (tool === undefined) {
      return { output: `unsupported tool: ${name}` };
    }
    return await tool.execute(args, context);
  }
}

export function createToolRegistry(config: NdxConfig): ToolRegistry {
  return new ToolRegistry(config);
}

function dedupeTools(tools: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
