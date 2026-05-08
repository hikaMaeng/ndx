import type {
  ModelClient,
  ModelResponse,
  ModelStreamEvent,
} from "../shared/types.js";

export class MockModelClient implements ModelClient {
  private step = 0;

  async create(input: unknown): Promise<ModelResponse> {
    if (this.step === 0) {
      this.step += 1;
      const prompt = promptText(input);
      return {
        id: "mock-response-1",
        text: "",
        toolCalls: [
          {
            callId: "mock-call-1",
            name: "shell",
            arguments: JSON.stringify({ command: commandForPrompt(prompt) }),
          },
        ],
        raw: { mock: true },
      };
    }

    this.step += 1;
    return {
      id: `mock-response-${this.step}`,
      text: "mock agent completed",
      toolCalls: [],
      raw: { input },
    };
  }

  async *stream(input: unknown): AsyncIterable<ModelStreamEvent> {
    const response = await this.create(input);
    yield { type: "response_started", responseId: response.id };
    if (response.text.length > 0) {
      const itemId = response.id === undefined ? "mock-message" : response.id;
      yield { type: "item_started", itemId, itemType: "message" };
      yield { type: "text_delta", itemId, delta: response.text };
      yield {
        type: "item_completed",
        itemId,
        itemType: "message",
        text: response.text,
      };
    }
    for (const call of response.toolCalls) {
      yield {
        type: "item_started",
        itemId: call.callId,
        itemType: "function_call",
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      };
      yield {
        type: "tool_call_delta",
        itemId: call.callId,
        callId: call.callId,
        delta: call.arguments,
      };
      yield {
        type: "item_completed",
        itemId: call.callId,
        itemType: "function_call",
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      };
    }
    yield { type: "response_completed", response };
  }
}

function promptText(input: unknown): string {
  if (Array.isArray(input)) {
    const lastUser = input
      .filter(
        (item): item is { type: "message"; role: "user"; content: string } =>
          typeof item === "object" &&
          item !== null &&
          (item as { type?: unknown }).type === "message" &&
          (item as { role?: unknown }).role === "user" &&
          typeof (item as { content?: unknown }).content === "string",
      )
      .at(-1);
    return lastUser?.content ?? String(input);
  }
  return String(input);
}

function commandForPrompt(prompt: string): string {
  const createFile = /create a file named\s+([^\s]+)\s+with text\s+(.+)$/i.exec(
    prompt.trim(),
  );
  if (createFile) {
    const file = shellQuote(createFile[1] ?? "tmp/ndx-mock.txt");
    const text = shellQuote(createFile[2] ?? "verified");
    return `mkdir -p "$(dirname ${file})" && printf %s ${text} > ${file} && cat ${file}`;
  }
  return "pwd && ls -1 | sed -n '1,20p'";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
