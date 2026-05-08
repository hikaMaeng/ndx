import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelConversationItem } from "../../model/types.js";
import type {
  ContextInstructionSource,
  NdxConfig,
} from "../../shared/types.js";

export function buildInitialContext(
  config: NdxConfig,
  cwd: string,
): ModelConversationItem[] {
  return [
    ...userInstructionMessages(config, cwd),
    environmentContextMessage(config, cwd),
  ];
}

function userInstructionMessages(
  config: NdxConfig,
  cwd: string,
): ModelConversationItem[] {
  const instructions = loadAgentInstructions(config.contextSources ?? []);
  if (instructions.length === 0) {
    return [];
  }
  return [
    {
      type: "message",
      role: "user",
      content: [
        `# AGENTS.md instructions for ${cwd}`,
        "",
        "<INSTRUCTIONS>",
        instructions,
        "</INSTRUCTIONS>",
      ].join("\n"),
    },
  ];
}

function loadAgentInstructions(sources: ContextInstructionSource[]): string {
  return sources
    .filter((source) => source.kind === "agents")
    .map((source) => readInstructionSource(source.path))
    .filter((text) => text.length > 0)
    .join("\n\n--- project-doc ---\n\n");
}

function readInstructionSource(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8").trimEnd();
}

function environmentContextMessage(
  config: NdxConfig,
  cwd: string,
): ModelConversationItem {
  return {
    type: "message",
    role: "user",
    content: renderEnvironmentContext(config, cwd),
  };
}

function renderEnvironmentContext(config: NdxConfig, cwd: string): string {
  const lines = [
    "<environment_context>",
    `  <cwd>${escapeXml(cwd)}</cwd>`,
    `  <shell>${escapeXml(shellName())}</shell>`,
    `  <current_date>${new Date().toISOString().slice(0, 10)}</current_date>`,
    `  <timezone>${escapeXml(timezone())}</timezone>`,
    `  <permissions default_mode="${escapeXml(config.permissions.defaultMode)}" />`,
    `  <global_dir>${escapeXml(config.paths.globalDir)}</global_dir>`,
  ];
  if (config.paths.projectNdxDir !== undefined) {
    lines.push(
      `  <project_ndx_dir>${escapeXml(config.paths.projectNdxDir)}</project_ndx_dir>`,
    );
  }
  lines.push("</environment_context>");
  return lines.join("\n");
}

function shellName(): string {
  const shell = process.env.SHELL ?? process.env.ComSpec ?? "unknown";
  return shell.split(/[\\/]/).at(-1) ?? shell;
}

function timezone(): string {
  return (
    process.env.TZ ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "unknown"
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
