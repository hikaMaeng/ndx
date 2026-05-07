import { createToolRegistry } from "../tools/registry.js";
import { createInitialState } from "./loop/state.js";
import { runSamplingRequest } from "./loop/sampling.js";
import type { AgentRunOptions } from "./loop/types.js";

export type { AgentEvent, AgentRunOptions } from "./loop/types.js";

export async function runAgent(options: AgentRunOptions): Promise<string> {
  const state = createInitialState(options.prompt, options.config, options.cwd);
  const registry = await createToolRegistry(options.config);

  for (let turn = 0; turn < options.config.maxTurns; turn += 1) {
    const result = await runSamplingRequest(state, registry, options);
    if (!result.needsFollowUp) {
      return state.finalText;
    }
    state.input = result.nextInput;
  }

  options.onEvent?.({
    type: "warning",
    message: `agent stopped after max_turns=${options.config.maxTurns} before producing a final answer; current turn ended without closing the session and the requested work may be incomplete`,
  });
  return "";
}
