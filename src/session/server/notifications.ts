import type { RuntimeEventMsg } from "../../shared/protocol.js";

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export function runtimeNotification(
  sessionId: string,
  msg: RuntimeEventMsg,
): JsonRpcNotification {
  const params = { sessionId, event: msg };
  switch (msg.type) {
    case "session_configured":
      return { method: "session/configured", params };
    case "turn_started":
      return { method: "turn/started", params };
    case "agent_message":
      return { method: "item/agentMessage", params };
    case "tool_call":
      return { method: "item/toolCall", params };
    case "tool_result":
      return { method: "item/toolResult", params };
    case "token_count":
      return { method: "session/tokenUsage/updated", params };
    case "turn_complete":
      return { method: "turn/completed", params };
    case "turn_aborted":
      return { method: "turn/aborted", params };
    case "warning":
      return { method: "warning", params };
    case "error":
      return { method: "error", params };
  }
}

export function deletedSessionNotification(
  sessionId: string,
  message = "session was deleted",
): JsonRpcNotification {
  return {
    method: "session/deleted",
    params: {
      sessionId,
      message,
    },
  };
}
