import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { SkillMetadata } from "../../shared/types.js";
import {
  functionTool,
  objectSchema,
  optionalString,
  stringSchema,
} from "./schema.js";
import type { ToolDefinition, ToolArguments, ToolContext } from "./types.js";

export function skillTools(): ToolDefinition[] {
  return [listSkillsTool(), loadSkillTool()];
}

function listSkillsTool(): ToolDefinition {
  return {
    name: "list_skills",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "list_skills",
      "List available local skills with their names, descriptions, scopes, and canonical paths. Use this when a skill name is ambiguous.",
      objectSchema({}),
    ),
    execute: async (_args, context) => ({
      output: JSON.stringify({
        skills: skills(context).map((skill) => ({
          name: skill.name,
          description: skill.description,
          shortDescription: skill.shortDescription,
          scope: skill.scope,
          path: skill.path,
        })),
      }),
    }),
  };
}

function loadSkillTool(): ToolDefinition {
  return {
    name: "load_skill",
    supportsParallelToolCalls: true,
    schema: functionTool(
      "load_skill",
      "Load the full SKILL.md body for an available local skill by unique name or canonical path. Prefer this over shell/cat/PowerShell for skills.",
      objectSchema({
        name: stringSchema("Unique skill name to load."),
        path: stringSchema("Canonical SKILL.md path to load."),
      }),
    ),
    execute: async (args, context) => loadSkill(args, context),
  };
}

async function loadSkill(
  args: ToolArguments,
  context: ToolContext,
): Promise<{ output: string }> {
  const name = optionalString(args.name)?.trim();
  const path = optionalString(args.path)?.trim();
  const selected = selectSkill(skills(context), { name, path });
  if (selected.status !== "ok") {
    return { output: JSON.stringify(selected) };
  }
  try {
    return {
      output: JSON.stringify({
        status: "ok",
        name: selected.skill.name,
        description: selected.skill.description,
        scope: selected.skill.scope,
        path: selected.skill.path,
        markdown: readFileSync(selected.skill.path, "utf8"),
      }),
    };
  } catch (error) {
    return {
      output: JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        path: selected.skill.path,
      }),
    };
  }
}

function skills(context: ToolContext): SkillMetadata[] {
  return context.config.skills?.skills ?? [];
}

function selectSkill(
  candidates: SkillMetadata[],
  query: { name?: string; path?: string },
):
  | { status: "ok"; skill: SkillMetadata }
  | {
      status: "not_found" | "ambiguous" | "missing_argument";
      message: string;
      matches?: Array<
        Pick<SkillMetadata, "name" | "description" | "scope" | "path">
      >;
    } {
  if (query.path !== undefined && query.path.length > 0) {
    const canonical = canonicalPath(query.path);
    const skill = candidates.find((candidate) => candidate.path === canonical);
    if (skill !== undefined) {
      return { status: "ok", skill };
    }
    return {
      status: "not_found",
      message: `skill path not found: ${query.path}`,
      matches: summarizeSkills(candidates),
    };
  }

  if (query.name === undefined || query.name.length === 0) {
    return {
      status: "missing_argument",
      message: "provide a unique skill name or canonical SKILL.md path",
      matches: summarizeSkills(candidates),
    };
  }

  const exact = candidates.filter((skill) => skill.name === query.name);
  if (exact.length === 1) {
    return { status: "ok", skill: exact[0] };
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      message: `multiple skills named ${query.name}; call load_skill with path`,
      matches: summarizeSkills(exact),
    };
  }

  const lowerName = query.name.toLowerCase();
  const folded = candidates.filter(
    (skill) => skill.name.toLowerCase() === lowerName,
  );
  if (folded.length === 1) {
    return { status: "ok", skill: folded[0] };
  }
  return {
    status: folded.length > 1 ? "ambiguous" : "not_found",
    message:
      folded.length > 1
        ? `multiple skills named ${query.name}; call load_skill with path`
        : `skill not found: ${query.name}`,
    matches: summarizeSkills(folded.length > 0 ? folded : candidates),
  };
}

function summarizeSkills(
  skills: SkillMetadata[],
): Array<Pick<SkillMetadata, "name" | "description" | "scope" | "path">> {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
    path: skill.path,
  }));
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
