import type { ModelClient, ModelResponse, NdxConfig } from "../shared/types.js";
import { OpenAiChatCompletionsAdapter } from "./openai-chat.js";
import { OpenAiResponsesAdapter } from "./openai-responses.js";
import type { ModelInput, ProviderRequestOptions } from "./types.js";

export class OpenAiResponsesClient implements ModelClient {
  private readonly responses: OpenAiResponsesAdapter;
  private readonly chat: OpenAiChatCompletionsAdapter;
  private useChatFallback = false;

  constructor(config: NdxConfig) {
    if (config.activeProvider.type !== "openai") {
      throw new Error(
        `provider type ${config.activeProvider.type} is not supported by the OpenAI adapter`,
      );
    }
    const options: ProviderRequestOptions = {
      model: config.model,
      instructions: config.instructions,
      apiKey: config.activeProvider.key,
      baseUrl: config.activeProvider.url.replace(/\/$/, ""),
    };
    this.responses = new OpenAiResponsesAdapter(options);
    this.chat = new OpenAiChatCompletionsAdapter(options);
  }

  async create(
    input: ModelInput,
    previousResponseId?: string,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    if (this.useChatFallback) {
      return await this.chat.create(input, tools);
    }
    try {
      return await this.responses.create(input, previousResponseId, tools);
    } catch (error) {
      if (!isMissingResponsesApi(error)) {
        throw error;
      }
      this.useChatFallback = true;
      return await this.chat.create(input, tools);
    }
  }
}

function isMissingResponsesApi(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\b(404|405)\b/.test(error.message);
}
