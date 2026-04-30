import { configForModel } from "../config/index.js";
import type { ModelClient, ModelResponse, NdxConfig } from "../shared/types.js";
import type { ModelConversationItem, ModelInput } from "./types.js";

export type ProviderClientFactory = (config: NdxConfig) => ModelClient;

export class RoundRobinModelRouter implements ModelClient {
  private readonly cursors = new Map<string, number>();
  private readonly clients = new Map<string, ModelClient>();
  private readonly bindings = new Map<string, string>();
  private activePoolKey = "session";

  constructor(
    private readonly config: NdxConfig,
    private readonly createProviderClient: ProviderClientFactory,
  ) {}

  async create(
    input: ModelInput,
    tools: unknown[] = [],
  ): Promise<ModelResponse> {
    this.activePoolKey = this.poolKeyForInput(input) ?? this.activePoolKey;
    const model = this.boundModel(this.activePoolKey);
    const client = this.clientForModel(model);
    return await client.create(input, tools);
  }

  private poolKeyForInput(input: ModelInput): string | undefined {
    const prompt = promptText(input);
    if (prompt === undefined) {
      return undefined;
    }
    const customKey = Object.keys(this.config.modelPools.custom).find((key) =>
      new RegExp(`(^|\\s)@${escapeRegExp(key)}(?=\\s|$)`).test(prompt),
    );
    return customKey === undefined ? "session" : `custom:${customKey}`;
  }

  private nextModel(poolKey: string): string {
    const pool = this.poolForKey(poolKey);
    const index = this.cursors.get(poolKey) ?? 0;
    this.cursors.set(poolKey, index + 1);
    return pool[index % pool.length] ?? this.config.model;
  }

  private boundModel(poolKey: string): string {
    const pool = this.poolForKey(poolKey);
    const current = this.bindings.get(poolKey);
    if (pool.includes(this.config.model) && current !== this.config.model) {
      this.bindings.set(poolKey, this.config.model);
      return this.config.model;
    }
    if (current !== undefined && pool.includes(current)) {
      return current;
    }
    if (pool.includes(this.config.model)) {
      this.bindings.set(poolKey, this.config.model);
      return this.config.model;
    }
    const selected = this.nextModel(poolKey);
    this.bindings.set(poolKey, selected);
    return selected;
  }

  private poolForKey(poolKey: string): string[] {
    if (poolKey.startsWith("custom:")) {
      const key = poolKey.slice("custom:".length);
      return (
        this.config.modelPools.custom[key] ?? this.config.modelPools.session
      );
    }
    return this.config.modelPools.session;
  }

  private clientForModel(model: string): ModelClient {
    const key = this.clientKey(model);
    const cached = this.clients.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const client = this.createProviderClient(
      configForModel(this.config, model),
    );
    this.clients.set(key, client);
    return client;
  }

  private clientKey(model: string): string {
    const activeModel = this.config.models.find(
      (entry) => (entry.id ?? entry.name) === model,
    );
    return JSON.stringify({
      model,
      effort: activeModel?.activeEffort,
      think: activeModel?.activeThink,
      limitResponseLength: activeModel?.limitResponseLength,
      topK: activeModel?.topK,
      repeatPenalty: activeModel?.repeatPenalty,
      presencePenalty: activeModel?.presencePenalty,
      topP: activeModel?.topP,
      MinP: activeModel?.MinP,
    });
  }
}

function promptText(input: ModelInput): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input
    .filter(isUserMessage)
    .map((item) => item.content)
    .at(-1);
}

function isUserMessage(
  item: ModelConversationItem,
): item is { type: "message"; role: "user"; content: string } {
  return item.type === "message" && item.role === "user";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
