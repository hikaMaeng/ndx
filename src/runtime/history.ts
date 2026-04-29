import type { ModelConversationItem } from "../model/types.js";
import type { ModelToolCall } from "../shared/types.js";
import type { RuntimeEvent } from "../shared/protocol.js";

export function conversationHistoryFromRuntimeEvents(
  events: RuntimeEvent[],
): ModelConversationItem[] {
  const history: ModelConversationItem[] = [];
  const pendingToolCalls = new Map<string, ModelToolCall[]>();
  const turnToolCounts = new Map<string, number>();

  for (const event of events) {
    const msg = event.msg;
    if (msg.type === "turn_started") {
      history.push({
        type: "message",
        role: "user",
        content: msg.prompt,
      });
      continue;
    }
    if (msg.type === "tool_call") {
      const count = (turnToolCounts.get(msg.turnId) ?? 0) + 1;
      turnToolCounts.set(msg.turnId, count);
      const call = {
        callId: `restored-${msg.turnId}-${count}`,
        name: msg.name,
        arguments: msg.arguments,
      };
      pendingToolCalls.set(msg.turnId, [
        ...(pendingToolCalls.get(msg.turnId) ?? []),
        call,
      ]);
      history.push({
        type: "assistant_tool_calls",
        toolCalls: [call],
      });
      continue;
    }
    if (msg.type === "tool_result") {
      const pending = pendingToolCalls.get(msg.turnId) ?? [];
      const call = pending.shift();
      pendingToolCalls.set(msg.turnId, pending);
      if (call !== undefined) {
        history.push({
          type: "function_call_output",
          call_id: call.callId,
          output: msg.output,
        });
      }
      continue;
    }
    if (msg.type === "agent_message" && msg.text.length > 0) {
      history.push({
        type: "message",
        role: "assistant",
        content: msg.text,
      });
      continue;
    }
    if (msg.type === "turn_complete" && msg.finalText.length > 0) {
      const last = history.at(-1);
      if (
        last?.type !== "message" ||
        last.role !== "assistant" ||
        last.content !== msg.finalText
      ) {
        history.push({
          type: "message",
          role: "assistant",
          content: msg.finalText,
        });
      }
    }
  }

  return history;
}
