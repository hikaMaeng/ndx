import type { JsonObject } from "../types.js";
import type { ToolSchema } from "./types.js";

export function functionTool(
  name: string,
  description: string,
  parameters: JsonObject,
): ToolSchema {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
    },
  };
}

export function objectSchema(
  properties: Record<string, JsonObject>,
  required: string[] = [],
): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

export function stringSchema(description?: string): JsonObject {
  return description === undefined
    ? { type: "string" }
    : { type: "string", description };
}

export function numberSchema(description?: string): JsonObject {
  return description === undefined
    ? { type: "number" }
    : { type: "number", description };
}

export function integerSchema(description?: string): JsonObject {
  return description === undefined
    ? { type: "integer" }
    : { type: "integer", description };
}

export function booleanSchema(description?: string): JsonObject {
  return description === undefined
    ? { type: "boolean" }
    : { type: "boolean", description };
}

export function arraySchema(items: JsonObject, description?: string): JsonObject {
  return description === undefined
    ? { type: "array", items }
    : { type: "array", items, description };
}

export function unknownArgs(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
