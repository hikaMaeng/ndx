import { shellToolSchema } from "./tools/shell.js";
import type {
  ModelClient,
  ModelResponse,
  ModelToolCall,
  NdxConfig,
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
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCallPayload[];
}

interface FunctionCallOutputItem {
  type?: string;
  call_id?: string;
  output?: string;
}

export class OpenAiResponsesClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: NdxConfig;
  private readonly messages: ChatMessage[];

  constructor(config: NdxConfig, env: NodeJS.ProcessEnv = process.env) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required unless --mock is used");
    }
    this.apiKey = apiKey;
    this.baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.config = config;
    this.messages = [{ role: "system", content: config.instructions }];
  }

  async create(input: unknown): Promise<ModelResponse> {
    this.appendInput(input);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.messages,
        tools: [chatToolSchema()],
        tool_choice: "auto",
      }),
    });
    if (!response.ok) {
      throw new Error(
        `OpenAI chat completions failed: ${response.status} ${await response.text()}`,
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

  private appendInput(input: unknown): void {
    if (typeof input === "string") {
      this.messages.push({ role: "user", content: input });
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input as FunctionCallOutputItem[]) {
        if (item.type === "function_call_output" && item.call_id) {
          this.messages.push({
            role: "tool",
            tool_call_id: item.call_id,
            content: item.output ?? "",
          });
        }
      }
      return;
    }

    this.messages.push({ role: "user", content: JSON.stringify(input) });
  }
}

export function normalizeChatResponse(
  payload: ChatCompletionsPayload,
): ModelResponse {
  const message = payload.choices?.[0]?.message ?? {};
  const toolCalls: ModelToolCall[] = (message.tool_calls ?? [])
    .filter((item) => item.type === "function" || item.function !== undefined)
    .map((item) => ({
      callId: item.id ?? "",
      name: item.function?.name ?? "",
      arguments: item.function?.arguments ?? "{}",
    }))
    .filter((call) => call.callId.length > 0 && call.name.length > 0);

  return {
    text: message.content ?? "",
    toolCalls,
    raw: payload,
  };
}

function chatToolSchema(): Record<string, unknown> {
  const schema = shellToolSchema();
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  };
}
