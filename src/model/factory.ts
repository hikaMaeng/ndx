import type { ModelClient, NdxConfig } from "../shared/types.js";
import { AnthropicMessagesAdapter } from "./anthropic.js";
import { withOperationalInstructions } from "./instructions.js";
import { OpenAiResponsesClient } from "./openai.js";
import { RoundRobinModelRouter } from "./router.js";
import type { ProviderRequestOptions } from "./types.js";

export function createRoutedModelClient(config: NdxConfig): ModelClient {
  return new RoundRobinModelRouter(config, createProviderModelClient);
}

export function createProviderModelClient(config: NdxConfig): ModelClient {
  if (config.activeProvider.type === "openai") {
    return new OpenAiResponsesClient(config);
  }
  if (config.activeProvider.type === "anthropic") {
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
    return new AnthropicMessagesAdapter(options);
  }
  throw new Error(`unsupported provider type: ${config.activeProvider.type}`);
}
