import type { ModelResponse } from "../shared/types.js";

export type ModelInput =
  | string
  | Array<{ type: "function_call_output"; call_id: string; output: string }>
  | unknown;

export interface ModelAdapter {
  create(
    input: ModelInput,
    previousResponseId?: string,
    tools?: unknown[],
  ): Promise<ModelResponse>;
}

export interface ProviderRequestOptions {
  model: string;
  instructions: string;
  apiKey: string;
  baseUrl: string;
}
