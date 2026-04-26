import { shellToolSchema } from "./tools/shell.js";
import type {
  ModelClient,
  ModelResponse,
  ModelToolCall,
  NdxConfig,
} from "./types.js";

interface ResponsesApiOutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponsesApiPayload {
  id?: string;
  output?: ResponsesApiOutputItem[];
  output_text?: string;
}

export class OpenAiResponsesClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: NdxConfig;

  constructor(config: NdxConfig, env: NodeJS.ProcessEnv = process.env) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required unless --mock is used");
    }
    this.apiKey = apiKey;
    this.baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.config = config;
  }

  async create(
    input: unknown,
    previousResponseId?: string,
  ): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      instructions: this.config.instructions,
      input,
      tools: [shellToolSchema()],
      parallel_tool_calls: false,
    };
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `OpenAI Responses API failed: ${response.status} ${await response.text()}`,
      );
    }
    return normalizeResponse((await response.json()) as ResponsesApiPayload);
  }
}

export function normalizeResponse(payload: ResponsesApiPayload): ModelResponse {
  const output = payload.output ?? [];
  const toolCalls: ModelToolCall[] = output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      callId: item.call_id ?? "",
      name: item.name ?? "",
      arguments: item.arguments ?? "{}",
    }))
    .filter((call) => call.callId.length > 0 && call.name.length > 0);

  const text =
    payload.output_text ??
    output
      .flatMap((item) => item.content ?? [])
      .filter(
        (content) => content.type === "output_text" || content.type === "text",
      )
      .map((content) => content.text ?? "")
      .join("\n");

  return { id: payload.id, text, toolCalls, raw: payload };
}
