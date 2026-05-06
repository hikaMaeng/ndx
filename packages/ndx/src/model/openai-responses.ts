import type {
  ModelResponse,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "message" }> {
  return (
    isObject(input) &&
    input.type === "message" &&
    (input.role === "user" || input.role === "assistant") &&
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
