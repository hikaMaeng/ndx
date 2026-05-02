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

interface ChatToolCallPayload {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatMessagePayload {
  content?: string | null;
  tool_calls?: ChatToolCallPayload[];
}

interface ChatCompletionsPayload {
  choices?: Array<{
    message?: ChatMessagePayload;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCallPayload[];
}

export class OpenAiChatCompletionsAdapter {
  private readonly messages: ChatMessage[];

  constructor(private readonly options: ProviderRequestOptions) {
    this.messages = [{ role: "system", content: options.instructions }];
  }

  async create(
    input: ModelInput,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    this.appendInput(input);
    const response = await postJson(
      `${this.options.baseUrl}/chat/completions`,
      providerHeaders(this.options.apiKey),
      {
        model: this.options.model,
        messages: this.messages,
        tools,
        tool_choice: "auto",
        ...optionalProviderParameters(this.options),
      },
    );
    if (!response.ok) {
      throw new Error(
        `OpenAI chat completions failed: ${await errorText(response)}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionsPayload;
    const message = payload.choices?.[0]?.message ?? {};
    this.messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });
    return normalizeChatResponse(payload);
  }

  private appendInput(input: ModelInput): void {
    if (typeof input === "string") {
      this.messages.push({ role: "user", content: input });
      return;
    }

    if (Array.isArray(input)) {
      if (input.some((item) => isMessage(item) || isAssistantToolCalls(item))) {
        this.messages.length = 1;
      }
      for (const item of input) {
        if (isFunctionCallOutput(item)) {
          this.messages.push({
            role: "tool",
            tool_call_id: item.call_id,
            content: item.output,
          });
        } else if (isMessage(item)) {
          this.messages.push({
            role: item.role,
            content: item.content,
          });
        } else if (isAssistantToolCalls(item)) {
          this.messages.push({
            role: "assistant",
            content: null,
            tool_calls: item.toolCalls.map((call) => ({
              id: call.callId,
              type: "function",
              function: {
                name: call.name,
                arguments: call.arguments,
              },
            })),
          });
        }
      }
      return;
    }

    this.messages.push({ role: "user", content: JSON.stringify(input) });
  }
}

function optionalProviderParameters(
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

function isMessage(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "message" }> {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { type?: unknown }).type === "message" &&
    ((input as { role?: unknown }).role === "user" ||
      (input as { role?: unknown }).role === "assistant") &&
    typeof (input as { content?: unknown }).content === "string"
  );
}

function isAssistantToolCalls(
  input: unknown,
): input is Extract<ModelConversationItem, { type: "assistant_tool_calls" }> {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { type?: unknown }).type === "assistant_tool_calls" &&
    Array.isArray((input as { toolCalls?: unknown }).toolCalls)
  );
}

export function normalizeChatResponse(
  payload: ChatCompletionsPayload,
): ModelResponse {
  const message = payload.choices?.[0]?.message ?? {};
  return {
    text: message.content ?? "",
    toolCalls: normalizeChatToolCalls(message.tool_calls ?? []),
    usage: normalizeChatUsage(payload.usage),
    raw: payload,
  };
}

function normalizeChatToolCalls(
  toolCalls: ChatToolCallPayload[],
): ModelToolCall[] {
  return toolCalls
    .filter((item) => item.type === "function" || item.function !== undefined)
    .map((item) => ({
      callId: item.id ?? "",
      name: item.function?.name ?? "",
      arguments: item.function?.arguments ?? "{}",
    }))
    .filter((call) => call.callId.length > 0 && call.name.length > 0);
}

function normalizeChatUsage(
  usage: ChatCompletionsPayload["usage"],
): TokenUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      };
}

function isFunctionCallOutput(
  input: unknown,
): input is { type: "function_call_output"; call_id: string; output: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { type?: unknown }).type === "function_call_output" &&
    typeof (input as { call_id?: unknown }).call_id === "string"
  );
}
