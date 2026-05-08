import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelConversationItem } from "../../model/types.js";
import type { NdxConfig, SkillMetadata } from "../../shared/types.js";

export function selectedSkillMessages(
  prompt: string,
  config: NdxConfig,
  cwd: string,
): ModelConversationItem[] {
  const skills = config.skills?.skills ?? [];
  if (skills.length === 0) {
    return [];
  }
  return collectSelectedSkills(prompt, skills, cwd).flatMap((skill) => {
    try {
      return [
        {
          type: "message" as const,
          role: "user" as const,
          content: [
            `# Skill: ${skill.name}`,
            "",
            `<SKILL path="${skill.path}">`,
            readFileSync(skill.path, "utf8").trimEnd(),
            "</SKILL>",
          ].join("\n"),
        },
      ];
    } catch {
      return [];
    }
  });
}

function collectSelectedSkills(
  prompt: string,
  skills: SkillMetadata[],
  cwd: string,
): SkillMetadata[] {
  const selected: SkillMetadata[] = [];
  const seenPaths = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const skill of skills) {
    nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
  }

  for (const path of linkedSkillPaths(prompt)) {
    const resolved = canonicalSkillPath(path, cwd);
    const skill = skills.find((candidate) => candidate.path === resolved);
    if (skill !== undefined && !seenPaths.has(skill.path)) {
      seenPaths.add(skill.path);
      selected.push(skill);
    }
  }

  for (const name of plainSkillMentions(prompt)) {
    if ((nameCounts.get(name) ?? 0) !== 1) {
      continue;
    }
    const skill = skills.find((candidate) => candidate.name === name);
    if (skill !== undefined && !seenPaths.has(skill.path)) {
      seenPaths.add(skill.path);
      selected.push(skill);
    }
  }

  return selected;
}

function linkedSkillPaths(prompt: string): string[] {
  const paths: string[] = [];
  const pattern = /\[\$([A-Za-z0-9_.:-]+)\]\(([^)]+)\)/g;
  for (const match of prompt.matchAll(pattern)) {
    const path = (match[2] ?? "").trim();
    if (path.endsWith("SKILL.md") || path.startsWith("skill://")) {
      paths.push(path);
    }
  }
  return paths;
}

function plainSkillMentions(prompt: string): string[] {
  const names = new Set<string>();
  const pattern = /(^|[^\w])\$([A-Za-z0-9_.:-]+)/g;
  for (const match of prompt.matchAll(pattern)) {
    const name = match[2] ?? "";
    if (!isCommonEnvironmentVariable(name)) {
      names.add(name);
    }
  }
  return [...names];
}

function canonicalSkillPath(path: string, cwd: string): string {
  const withoutScheme = path.startsWith("skill://")
    ? path.slice("skill://".length)
    : path;
  const absolute = withoutScheme.startsWith("/")
    ? withoutScheme
    : resolve(cwd, withoutScheme);
  try {
    return realpathSync(absolute);
  } catch {
    return resolve(absolute);
  }
}

function isCommonEnvironmentVariable(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}
