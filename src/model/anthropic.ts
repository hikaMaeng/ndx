import type {
  ModelResponse,
  ModelToolCall,
  TokenUsage,
} from "../shared/types.js";
import { errorText, postJson } from "./http.js";
import type { ModelInput, ProviderRequestOptions } from "./types.js";

interface AnthropicContent {
  type?: string;
  text?: string;
  id?: string;
  tool_use_id?: string;
  name?: string;
  content?: string;
  input?: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

interface AnthropicPayload {
  id?: string;
  content?: AnthropicContent[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface OpenAiToolSchema {
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

export class AnthropicMessagesAdapter {
  private readonly messages: AnthropicMessage[] = [];

  constructor(private readonly options: ProviderRequestOptions) {}

  async create(
    input: ModelInput,
    _previousResponseId?: string,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    this.appendInput(input);
    const response = await postJson(
      `${this.options.baseUrl}/messages`,
      this.headers(),
      {
        model: this.options.model,
        system: this.options.instructions,
        max_tokens: 4096,
        messages: this.messages,
        tools: normalizeAnthropicTools(tools),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Anthropic messages failed: ${await errorText(response)}`,
      );
    }

    const payload = (await response.json()) as AnthropicPayload;
    this.messages.push({
      role: "assistant",
      content: payload.content ?? [],
    });
    return normalizeAnthropicResponse(payload);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.options.apiKey.length > 0) {
      headers["x-api-key"] = this.options.apiKey;
    }
    return headers;
  }

  private appendInput(input: ModelInput): void {
    if (typeof input === "string") {
      this.messages.push({ role: "user", content: input });
      return;
    }
    if (Array.isArray(input)) {
      this.messages.push({
        role: "user",
        content: input.filter(isFunctionCallOutput).map((item) => ({
          type: "tool_result",
          tool_use_id: item.call_id,
          content: item.output,
        })),
      });
      return;
    }
    this.messages.push({ role: "user", content: JSON.stringify(input) });
  }
}

export function normalizeAnthropicResponse(
  payload: AnthropicPayload,
): ModelResponse {
  const content = payload.content ?? [];
  return {
    id: payload.id,
    text: content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join(""),
    toolCalls: normalizeAnthropicToolCalls(content),
    usage: normalizeAnthropicUsage(payload.usage),
    raw: payload,
  };
}

function normalizeAnthropicToolCalls(
  content: AnthropicContent[],
): ModelToolCall[] {
  return content
    .filter((item) => item.type === "tool_use")
    .map((item) => ({
      callId: item.id ?? "",
      name: item.name ?? "",
      arguments: JSON.stringify(item.input ?? {}),
    }))
    .filter((call) => call.callId.length > 0 && call.name.length > 0);
}

function normalizeAnthropicTools(tools: unknown[]): unknown[] {
  return tools
    .map((tool) => tool as OpenAiToolSchema)
    .map((tool) => ({
      name: tool.function?.name,
      description: tool.function?.description ?? "",
      input_schema: tool.function?.parameters ?? {
        type: "object",
        additionalProperties: false,
      },
    }))
    .filter((tool) => typeof tool.name === "string" && tool.name.length > 0);
}

function normalizeAnthropicUsage(
  usage: AnthropicPayload["usage"],
): TokenUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens:
          usage.input_tokens === undefined || usage.output_tokens === undefined
            ? undefined
            : usage.input_tokens + usage.output_tokens,
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
