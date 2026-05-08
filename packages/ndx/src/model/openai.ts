import type {
  ModelClient,
  ModelResponse,
  ModelStreamEvent,
  NdxConfig,
} from "../shared/types.js";
import { withOperationalInstructions } from "./instructions.js";
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
      model: config.activeModel.name,
      instructions: withOperationalInstructions(config.instructions),
      apiKey: config.activeProvider.key,
      baseUrl: config.activeProvider.url.replace(/\/$/, ""),
      effort: config.activeModel.activeEffort,
      think: config.activeModel.activeThink,
      limitResponseLength: config.activeModel.limitResponseLength,
      temperature: config.activeModel.temperature,
      topK: config.activeModel.topK,
      repeatPenalty: config.activeModel.repeatPenalty,
      presencePenalty: config.activeModel.presencePenalty,
      topP: config.activeModel.topP,
      MinP: config.activeModel.MinP,
    };
    this.responses = new OpenAiResponsesAdapter(options);
    this.chat = new OpenAiChatCompletionsAdapter(options);
  }

  async create(
    input: ModelInput,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    if (this.useChatFallback) {
      return await this.chat.create(input, tools);
    }
    try {
      return await this.responses.create(input, tools);
    } catch (error) {
      if (!isMissingResponsesApi(error)) {
        throw error;
      }
      this.useChatFallback = true;
      return await this.chat.create(input, tools);
    }
  }

  async *stream(
    input: ModelInput,
    tools: unknown[] = [],
    signal?: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    if (this.useChatFallback) {
      yield* streamFromCreate(this.chat, input, tools);
      return;
    }
    try {
      yield* this.responses.stream(input, tools, signal);
    } catch (error) {
      if (!isMissingResponsesApi(error)) {
        throw error;
      }
      this.useChatFallback = true;
      yield* streamFromCreate(this.chat, input, tools);
    }
  }
}

function isMissingResponsesApi(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\b(404|405)\b/.test(error.message);
}

async function* streamFromCreate(
  client: ModelClient,
  input: ModelInput,
  tools: unknown[],
): AsyncIterable<ModelStreamEvent> {
  const response = await client.create(input, tools);
  yield { type: "response_started", responseId: response.id };
  if (response.text.length > 0) {
    const itemId =
      response.id === undefined ? "message" : `${response.id}:message`;
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
    const itemId = call.callId;
    yield {
      type: "item_started",
      itemId,
      itemType: "function_call",
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
    };
    yield {
      type: "tool_call_delta",
      itemId,
      callId: call.callId,
      delta: call.arguments,
    };
    yield {
      type: "item_completed",
      itemId,
      itemType: "function_call",
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
    };
  }
  yield { type: "response_completed", response };
}
