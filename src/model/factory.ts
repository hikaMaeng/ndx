import type { ModelClient, NdxConfig } from "../shared/types.js";
import { AnthropicMessagesAdapter } from "./anthropic.js";
import { OpenAiResponsesClient } from "./openai.js";
import type { ProviderRequestOptions } from "./types.js";

export function createProviderModelClient(config: NdxConfig): ModelClient {
  if (config.activeProvider.type === "openai") {
    return new OpenAiResponsesClient(config);
  }
  if (config.activeProvider.type === "anthropic") {
    const options: ProviderRequestOptions = {
      model: config.model,
      instructions: config.instructions,
      apiKey: config.activeProvider.key,
      baseUrl: config.activeProvider.url.replace(/\/$/, ""),
    };
    return new AnthropicMessagesAdapter(options);
  }
  throw new Error(`unsupported provider type: ${config.activeProvider.type}`);
}
