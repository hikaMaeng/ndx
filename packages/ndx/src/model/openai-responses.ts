import type {
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  TokenUsage,
} from "../shared/types.js";
import { errorText, postJson, providerHeaders } from "./http.js";
import type {
  ModelConversationItem,
  ModelInput,
  ProviderRequestOptions,
} from "./types.js";

interface ResponsesPayload {
  id?: string;
  output_text?: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface ResponsesOutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export class OpenAiResponsesAdapter {
  constructor(private readonly options: ProviderRequestOptions) {}

  async create(
    input: ModelInput,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    const response = await postJson(
      `${this.options.baseUrl}/responses`,
      providerHeaders(this.options.apiKey),
      {
        model: this.options.model,
        instructions: this.options.instructions,
        input: responsesInput(input),
        tools: responsesTools(tools),
        tool_choice: "auto",
        ...optionalProviderParameters(this.options),
      },
    );
    if (!response.ok) {
      throw new Error(`OpenAI responses failed: ${await errorText(response)}`);
    }
    return normalizeResponsesPayload(
      (await response.json()) as ResponsesPayload,
    );
  }

  async *stream(
    input: ModelInput,
    tools: unknown[] = [],
    signal?: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const response = await postJson(
      `${this.options.baseUrl}/responses`,
      providerHeaders(this.options.apiKey, { Accept: "text/event-stream" }),
      {
        model: this.options.model,
        instructions: this.options.instructions,
        input: responsesInput(input),
        tools: responsesTools(tools),
        tool_choice: "auto",
        stream: true,
        ...optionalProviderParameters(this.options),
      },
      signal,
    );
    if (!response.ok) {
      throw new Error(`OpenAI responses failed: ${await errorText(response)}`);
    }
    if (response.body === null) {
      throw new Error("OpenAI responses stream failed: empty response body");
    }

    const items = new Map<string, ResponsesOutputItem>();
    let completed: ModelResponse | undefined;
    for await (const event of parseServerSentEvents(response.body)) {
      const mapped = mapResponsesStreamEvent(event, items);
      if (mapped !== undefined) {
        if (mapped.type === "response_completed") {
          completed = mapped.response;
        }
        yield mapped;
      }
    }
    if (completed === undefined) {
      throw new Error(
        "OpenAI responses stream ended before response.completed",
      );
    }
  }
}

export function optionalProviderParameters(
  options: ProviderRequestOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (options.effort !== undefined) {
    payload.reasoning_effort = options.effort;
  }
  if (options.think !== undefined) {
    payload.think = options.think;
  }
  if (options.limitResponseLength !== undefined) {
    payload.max_tokens = options.limitResponseLength;
    payload.max_output_tokens = options.limitResponseLength;
  }
  if (options.temperature !== undefined) {
    payload.temperature = options.temperature;
  }
  if (options.topK !== undefined) {
    payload.top_k = options.topK;
  }
  if (options.repeatPenalty !== undefined) {
    payload.repeat_penalty = options.repeatPenalty;
  }
  if (options.presencePenalty !== undefined) {
    payload.presence_penalty = options.presencePenalty;
  }
  if (options.topP !== undefined) {
    payload.top_p = options.topP;
  }
  if (options.MinP !== undefined) {
    payload.min_p = options.MinP;
  }
  return payload;
}

export function responsesInput(input: ModelInput): unknown {
  if (!Array.isArray(input)) {
    return input;
  }
  return input.flatMap((item) => {
    if (isMessage(item)) {
      return [
        {
          role: item.role,
          content: item.content,
        },
      ];
    }
    if (isAssistantToolCalls(item)) {
      return item.toolCalls.map((call) => ({
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      }));
    }
    if (isFunctionCallOutput(item)) {
      return [
        {
          type: "function_call_output",
          call_id: item.call_id,
          output: item.output,
        },
      ];
    }
    return [item];
  });
}

export function responsesTools(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!isObject(tool)) {
      return tool;
    }
    if (
      tool.type === "function" &&
      isObject(tool.function) &&
      typeof tool.function.name === "string"
    ) {
      return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      };
    }
    return tool;
  });
}

export function normalizeResponsesPayload(
  payload: ResponsesPayload,
): ModelResponse {
  return {
    id: payload.id,
    text: payload.output_text ?? outputText(payload.output ?? []),
    toolCalls: normalizeResponseToolCalls(payload.output ?? []),
    usage: normalizeResponsesUsage(payload.usage),
    raw: payload,
  };
}

function outputText(output: ResponsesOutputItem[]): string {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter(
      (content) => content.type === "output_text" && content.text !== undefined,
    )
    .map((content) => content.text ?? "")
    .join("");
}

function normalizeResponseToolCalls(
  output: ResponsesOutputItem[],
): ModelToolCall[] {
  return output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      callId: item.call_id ?? item.id ?? "",
      name: item.name ?? "",
      arguments: item.arguments ?? "{}",
    }))
    .filter((call) => call.callId.length > 0 && call.name.length > 0);
}

function normalizeResponsesUsage(
  usage: ResponsesPayload["usage"],
): TokenUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
      };
}

async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = buffer.search(/\r?\n\r?\n/);
      while (splitIndex >= 0) {
        const chunk = buffer.slice(0, splitIndex);
        buffer = buffer.slice(
          buffer[splitIndex] === "\r" ? splitIndex + 4 : splitIndex + 2,
        );
        const data = chunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n");
        if (data.length > 0 && data !== "[DONE]") {
          yield JSON.parse(data) as Record<string, unknown>;
        }
        splitIndex = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function mapResponsesStreamEvent(
  event: Record<string, unknown>,
  items: Map<string, ResponsesOutputItem>,
): ModelStreamEvent | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "response.created") {
    const response = objectValue(event.response);
    return {
      type: "response_started",
      responseId: stringValue(response?.id),
    };
  }
  if (type === "response.output_item.added") {
    const item = objectValue(event.item) as ResponsesOutputItem | undefined;
    if (item === undefined) {
      return undefined;
    }
    const itemId = item.id ?? item.call_id ?? stringValue(event.item_id);
    if (itemId === undefined || itemId.length === 0) {
      return undefined;
    }
    items.set(itemId, { ...item });
    return {
      type: "item_started",
      itemId,
      itemType: streamItemType(item.type),
      callId: item.call_id,
      name: item.name,
      arguments: item.arguments,
    };
  }
  if (type === "response.output_text.delta") {
    const itemId = stringValue(event.item_id);
    const delta = stringValue(event.delta);
    return itemId === undefined || delta === undefined
      ? undefined
      : { type: "text_delta", itemId, delta };
  }
  if (type === "response.function_call_arguments.delta") {
    const itemId = stringValue(event.item_id);
    const delta = stringValue(event.delta);
    const callId = stringValue(event.call_id);
    return itemId === undefined || delta === undefined
      ? undefined
      : { type: "tool_call_delta", itemId, callId, delta };
  }
  if (type === "response.output_item.done") {
    const item = objectValue(event.item) as ResponsesOutputItem | undefined;
    if (item === undefined) {
      return undefined;
    }
    const itemId = item.id ?? item.call_id ?? stringValue(event.item_id);
    if (itemId === undefined || itemId.length === 0) {
      return undefined;
    }
    const previous = items.get(itemId) ?? {};
    const completedItem = { ...previous, ...item };
    items.set(itemId, completedItem);
    return {
      type: "item_completed",
      itemId,
      itemType: streamItemType(completedItem.type),
      text:
        completedItem.type === "message"
          ? outputText([completedItem])
          : undefined,
      callId: completedItem.call_id,
      name: completedItem.name,
      arguments: completedItem.arguments,
    };
  }
  if (type === "response.completed") {
    const response = objectValue(event.response) as
      | ResponsesPayload
      | undefined;
    return response === undefined
      ? undefined
      : {
          type: "response_completed",
          response: normalizeResponsesPayload(response),
        };
  }
  return undefined;
}

function streamItemType(
  value: string | undefined,
): "message" | "function_call" | "reasoning" | "other" {
  if (
    value === "message" ||
    value === "function_call" ||
    value === "reasoning"
  ) {
    return value;
  }
  return "other";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "message" }> {
  return (
    isObject(input) &&
    input.type === "message" &&
    (input.role === "system" ||
      input.role === "developer" ||
      input.role === "user" ||
      input.role === "assistant") &&
    typeof input.content === "string"
  );
}

function isAssistantToolCalls(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "assistant_tool_calls" }> {
  return (
    isObject(input) &&
    input.type === "assistant_tool_calls" &&
    Array.isArray(input.toolCalls)
  );
}

function isFunctionCallOutput(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "function_call_output" }> {
  return (
    isObject(input) &&
    input.type === "function_call_output" &&
    typeof input.call_id === "string" &&
    typeof input.output === "string"
  );
}
