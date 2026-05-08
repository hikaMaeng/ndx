import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve, sep } from "node:path";
import type { ModelConversationItem } from "../../model/types.js";

const MAX_ARTIFACTS = 8;
const MAX_TEXT_CHARS = 1_200;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

interface ArtifactContext {
  path: string;
  size: number;
  modifiedAt: string;
  excerpt?: string;
}

export function artifactContextMessages(
  prompt: string,
  history: ModelConversationItem[],
  cwd: string,
): ModelConversationItem[] {
  const artifacts = collectArtifacts(prompt, history, cwd);
  if (artifacts.length === 0) {
    return [];
  }
  return [
    {
      type: "message",
      role: "user",
      content: renderArtifactContext(artifacts),
    },
  ];
}

function collectArtifacts(
  prompt: string,
  history: ModelConversationItem[],
  cwd: string,
): ArtifactContext[] {
  const seen = new Set<string>();
  const artifacts: ArtifactContext[] = [];
  for (const candidate of candidatePaths(prompt, history)) {
    const path = resolveCandidate(candidate, cwd);
    if (path === undefined || seen.has(path) || !isUnderCwd(path, cwd)) {
      continue;
    }
    if (!existsSync(path)) {
      continue;
    }
    const stat = statSync(path);
    if (!stat.isFile()) {
      continue;
    }
    seen.add(path);
    artifacts.push({
      path,
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      excerpt: readTextExcerpt(path),
    });
    if (artifacts.length >= MAX_ARTIFACTS) {
      break;
    }
  }
  return artifacts;
}

function candidatePaths(
  prompt: string,
  history: ModelConversationItem[],
): string[] {
  const text = [...history.flatMap(itemText), prompt].join("\n");
  const candidates: string[] = [];
  const patterns = [
    /\[[^\]]*]\(([^)]+)\)/g,
    /`([^`\n]+\.[A-Za-z0-9]+(?::\d+)?)`/g,
    /((?:\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])[^"'`\s)]+?\.[A-Za-z0-9]+(?::\d+)?)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      candidates.push(cleanPath(match[1] ?? ""));
    }
  }
  return candidates;
}

function itemText(item: ModelConversationItem): string[] {
  if (item.type === "message") {
    return [item.content];
  }
  if (item.type === "function_call_output") {
    return [item.output];
  }
  if (item.type === "assistant_tool_calls") {
    return item.toolCalls.map((call) => call.arguments);
  }
  return [];
}

function cleanPath(value: string): string {
  return value
    .replace(/^file:\/\//, "")
    .replace(/:\d+$/, "")
    .replace(/[),.;]+$/, "")
    .trim();
}

function resolveCandidate(candidate: string, cwd: string): string | undefined {
  if (candidate.length === 0 || candidate.includes("://")) {
    return undefined;
  }
  const normalized = windowsPathToWsl(candidate).replaceAll("\\", sep);
  return isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(cwd, normalized);
}

function windowsPathToWsl(path: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  if (match === null) {
    return path;
  }
  return `/mnt/${match[1]?.toLowerCase()}/${match[2] ?? ""}`;
}

function isUnderCwd(path: string, cwd: string): boolean {
  const root = resolve(cwd);
  return path === root || path.startsWith(`${root}${sep}`);
}

function readTextExcerpt(path: string): string | undefined {
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
    return undefined;
  }
  return readFileSync(path, "utf8").slice(0, MAX_TEXT_CHARS);
}

function renderArtifactContext(artifacts: ArtifactContext[]): string {
  const lines = [
    "# Referenced Artifacts",
    "",
    "Existing local files referenced in prior model-visible context or the current prompt:",
    "",
    "<artifacts>",
  ];
  for (const artifact of artifacts) {
    lines.push(
      `  <artifact path="${escapeXml(artifact.path)}" size="${artifact.size}" modified_at="${escapeXml(artifact.modifiedAt)}">`,
    );
    if (artifact.excerpt !== undefined) {
      lines.push("    <excerpt>", indent(artifact.excerpt), "    </excerpt>");
    }
    lines.push("  </artifact>");
  }
  lines.push("</artifacts>");
  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `      ${line}`)
    .join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
