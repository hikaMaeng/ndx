import { createHash } from "node:crypto";
import type {
  ToolDefinition,
  ToolRequirementSet,
  ToolRequirements,
} from "./types.js";

/** Return an empty normalized tool requirement set. */
export function emptyToolRequirementSet(): ToolRequirementSet {
  return {
    apt: [],
    npmGlobal: [],
    pip: [],
    binaries: [],
    sources: [],
  };
}

/** Merge external tool requirements into a deterministic install contract. */
export function collectToolRequirements(
  tools: ToolDefinition[],
  options: { includeCore?: boolean } = {},
): ToolRequirementSet {
  const includeCore = options.includeCore ?? true;
  const result = emptyToolRequirementSet();
  const apt = new Set<string>();
  const npmGlobal = new Set<string>();
  const pip = new Set<string>();
  const binaries = new Set<string>();
  const browsers = new Set<string>();
  let playwrightWithDeps = false;

  for (const tool of tools) {
    if (tool.kind !== "external" || tool.runtime === undefined) {
      continue;
    }
    const layer = tool.layer ?? "unknown";
    if (!includeCore && layer === "core") {
      continue;
    }
    const requirements = tool.requirements ?? tool.runtime.requirements;
    addAll(apt, requirements.apt);
    addAll(npmGlobal, requirements.npmGlobal);
    addAll(pip, requirements.pip);
    addAll(binaries, requirements.binaries);
    if (requirements.playwright !== undefined) {
      addAll(browsers, requirements.playwright.browsers);
      playwrightWithDeps ||= requirements.playwright.withDeps;
    }
    if (!isEmptyRequirements(requirements)) {
      result.sources.push({
        tool: tool.name,
        layer,
        manifestPath: tool.runtime.manifestPath,
      });
    }
  }

  result.apt = sorted(apt);
  result.npmGlobal = sorted(npmGlobal);
  result.pip = sorted(pip);
  result.binaries = sorted(binaries);
  const playwrightBrowsers = sorted(browsers);
  if (playwrightBrowsers.length > 0) {
    result.playwright = {
      browsers: playwrightBrowsers,
      withDeps: playwrightWithDeps,
    };
  }
  result.sources.sort(
    (left, right) =>
      left.layer.localeCompare(right.layer) ||
      left.tool.localeCompare(right.tool) ||
      left.manifestPath.localeCompare(right.manifestPath),
  );
  return result;
}

/** Stable fingerprint for sandbox prepare cache checks. */
export function toolRequirementsFingerprint(
  requirements: ToolRequirementSet,
): string {
  return createHash("sha256")
    .update(JSON.stringify(requirementsForFingerprint(requirements)))
    .digest("hex");
}

export function isEmptyRequirementSet(
  requirements: ToolRequirementSet,
): boolean {
  return isEmptyRequirements(requirements);
}

function requirementsForFingerprint(
  requirements: ToolRequirementSet,
): Omit<ToolRequirementSet, "sources"> {
  return {
    apt: requirements.apt,
    npmGlobal: requirements.npmGlobal,
    pip: requirements.pip,
    binaries: requirements.binaries,
    ...(requirements.playwright === undefined
      ? {}
      : { playwright: requirements.playwright }),
  };
}

function isEmptyRequirements(requirements: ToolRequirements): boolean {
  return (
    requirements.apt.length === 0 &&
    requirements.npmGlobal.length === 0 &&
    requirements.pip.length === 0 &&
    requirements.binaries.length === 0 &&
    (requirements.playwright?.browsers.length ?? 0) === 0
  );
}

function addAll(target: Set<string>, values: string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function sorted(values: Set<string>): string[] {
  return [...values].sort();
}
