import { resolve } from "node:path";
import { NDX_DEFAULTS } from "../config/defaults.js";

export interface SandboxPathMapping {
  hostWorkspace?: string;
  sandboxWorkspace?: string;
  sandboxCwd?: string;
  hostGlobal?: string;
  sandboxGlobal?: string;
}

/** Map a host path into the Linux path namespace of the workspace sandbox. */
export function mapHostPathToSandboxPath(
  value: string,
  mapping: SandboxPathMapping,
): string {
  const sandboxWorkspace = normalizeContainerPath(
    mapping.sandboxWorkspace ?? NDX_DEFAULTS.containerWorkspaceDir,
  );
  const sandboxGlobal = normalizeContainerPath(
    mapping.sandboxGlobal ?? NDX_DEFAULTS.containerGlobalDir,
  );
  const sandboxCwd = normalizeContainerPath(
    mapping.sandboxCwd ?? sandboxWorkspace,
  );

  if (value.length === 0) {
    return sandboxCwd;
  }

  const absolute = isHostAbsolutePath(value);
  const normalized = absolute ? normalizeHostAbsolutePath(value) : value;

  if (absolute && isInsideContainerRoot(normalized, sandboxWorkspace)) {
    return normalized;
  }
  if (absolute && isInsideContainerRoot(normalized, sandboxGlobal)) {
    return normalized;
  }

  const workspace = mapAgainstRoot(
    normalized,
    mapping.hostWorkspace,
    sandboxWorkspace,
  );
  if (workspace !== undefined) {
    return workspace;
  }

  const global = mapAgainstRoot(normalized, mapping.hostGlobal, sandboxGlobal);
  if (global !== undefined) {
    return global;
  }

  return absolute ? sandboxCwd : value;
}

function mapAgainstRoot(
  value: string,
  hostRoot: string | undefined,
  sandboxRoot: string,
): string | undefined {
  if (hostRoot === undefined || hostRoot.length === 0) {
    return undefined;
  }
  const root = normalizeHostAbsolutePath(hostRoot);
  if (sameHostPath(value, root)) {
    return sandboxRoot;
  }
  const valueKey = hostPathKey(value);
  const rootKey = hostPathKey(root);
  if (!valueKey.startsWith(`${rootKey}/`)) {
    return undefined;
  }
  return `${sandboxRoot}${value.slice(root.length)}`;
}

function isHostAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

function normalizeHostAbsolutePath(value: string): string {
  const absolute = /^[a-zA-Z]:[\\/]/.test(value) ? value : resolve(value);
  return trimTrailingSeparators(absolute.replace(/\\/g, "/"));
}

function normalizeContainerPath(value: string): string {
  return trimTrailingSeparators(value.replace(/\\/g, "/"));
}

function trimTrailingSeparators(value: string): string {
  let result = value;
  while (
    result.length > 1 &&
    !/^[a-zA-Z]:\/$/.test(result) &&
    result.endsWith("/")
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

function sameHostPath(left: string, right: string): boolean {
  return hostPathKey(left) === hostPathKey(right);
}

function hostPathKey(value: string): string {
  return /^[a-zA-Z]:\//.test(value) ? value.toLowerCase() : value;
}

function isInsideContainerRoot(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`);
}
