import type { RuntimeEvent } from "../../shared/protocol.js";

export type RuntimeStatus = "idle" | "running" | "aborted" | "failed";

export function recordTimestamp(record: Record<string, unknown>): number {
  for (const key of [
    "recordedAt",
    "requestedAt",
    "disconnectedAt",
    "restoredAt",
    "subscribedAt",
    "createdAt",
    "persistedAt",
  ]) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return 0;
}

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const event = value as { id?: unknown; msg?: unknown };
  return (
    typeof event.id === "string" &&
    event.msg !== null &&
    typeof event.msg === "object"
  );
}

export function statusFromEvent(
  event: RuntimeEvent,
  fallback: RuntimeStatus,
): RuntimeStatus {
  switch (event.msg.type) {
    case "turn_started":
      return "running";
    case "turn_complete":
      return "idle";
    case "turn_aborted":
      return "aborted";
    case "error":
      return "failed";
    default:
      return fallback;
  }
}

export function isTerminalEvent(event: RuntimeEvent): boolean {
  return (
    event.msg.type === "turn_complete" ||
    event.msg.type === "turn_aborted" ||
    event.msg.type === "error"
  );
}

export function eventTurnId(event: RuntimeEvent): string | undefined {
  const value = (event.msg as { turnId?: unknown }).turnId;
  return typeof value === "string" ? value : undefined;
}

export function parseThreadStatus(value: unknown): RuntimeStatus | undefined {
  return value === "idle" ||
    value === "running" ||
    value === "aborted" ||
    value === "failed"
    ? value
    : undefined;
}
