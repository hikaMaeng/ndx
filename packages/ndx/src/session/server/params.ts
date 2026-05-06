import type { SlashCommandExecution } from "../commands/registry.js";

export function requiredStringParam(params: unknown, name: string): string {
  const value = stringParam(params, name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function sessionIdParam(params: unknown): string {
  return stringParam(params, "sessionId") ?? requiredStringParam(params, "id");
}

export function stringParam(params: unknown, name: string): string | undefined {
  if (params === null || typeof params !== "object") {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function slashCommandExecution(params: unknown): SlashCommandExecution {
  const name = requiredStringParam(params, "name");
  if (name.startsWith("/")) {
    throw new Error("command name must not include a leading slash");
  }
  return {
    name,
    args: stringParam(params, "args"),
    sessionId: stringParam(params, "sessionId"),
    cwd: stringParam(params, "cwd"),
  };
}
