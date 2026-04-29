import type {
  ModelResponse,
  ModelToolCall,
  TokenUsage,
} from "../shared/types.js";
import { errorText, postJson, providerHeaders } from "./http.js";
import type { ModelInput, ProviderRequestOptions } from "./types.js";

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
    previousResponseId?: string,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    const response = await postJson(
      `${this.options.baseUrl}/responses`,
      providerHeaders(this.options.apiKey),
      {
        model: this.options.model,
        instructions: this.options.instructions,
        input,
        previous_response_id: previousResponseId,
        tools,
        tool_choice: "auto",
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
