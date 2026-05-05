import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { throwIfAborted } from "../runtime/abort.js";
import { createToolRegistry } from "../session/tools/registry.js";
import { executeToolInWorker } from "../session/tools/process-runner.js";
import { unknownArgs } from "../session/tools/schema.js";
import type {
  ModelClient,
  ModelResponse,
  ModelToolCall,
  NdxConfig,
  SkillMetadata,
  TokenUsage,
} from "../shared/types.js";
import type { ModelConversationItem } from "../model/types.js";
import type { ToolRegistry } from "../session/tools/registry.js";

export interface AgentRunOptions {
  cwd: string;
  config: NdxConfig;
  client: ModelClient;
  prompt: string;
  history?: ModelConversationItem[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "model_text"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "token_count"; usage: TokenUsage };

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

  throw new Error(`agent stopped after max_turns=${options.config.maxTurns}`);
}

interface AgentLoopState {
  input: ModelConversationItem[];
  finalText: string;
}

type SamplingResult =
  | { needsFollowUp: false }
  | { needsFollowUp: true; nextInput: ModelConversationItem[] };

function createInitialState(
  prompt: string,
  config: NdxConfig,
  cwd: string,
): AgentLoopState {
  const skillMessages = selectedSkillMessages(prompt, config, cwd);
  return {
    input: [
      ...skillMessages,
      { type: "message", role: "user", content: prompt },
    ],
    finalText: "",
  };
}

function selectedSkillMessages(
  prompt: string,
  config: NdxConfig,
  cwd: string,
): ModelConversationItem[] {
  const skills = config.skills?.skills ?? [];
  if (skills.length === 0) {
    return [];
  }
  return collectSelectedSkills(prompt, skills, cwd).flatMap((skill) => {
    try {
      return [
        {
          type: "message" as const,
          role: "user" as const,
          content: [
            `# Skill: ${skill.name}`,
            "",
            `<SKILL path="${skill.path}">`,
            readFileSync(skill.path, "utf8").trimEnd(),
            "</SKILL>",
          ].join("\n"),
        },
      ];
    } catch {
      return [];
    }
  });
}

function collectSelectedSkills(
  prompt: string,
  skills: SkillMetadata[],
  cwd: string,
): SkillMetadata[] {
  const selected: SkillMetadata[] = [];
  const seenPaths = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const skill of skills) {
    nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
  }

  for (const path of linkedSkillPaths(prompt)) {
    const resolved = canonicalSkillPath(path, cwd);
    const skill = skills.find((candidate) => candidate.path === resolved);
    if (skill !== undefined && !seenPaths.has(skill.path)) {
      seenPaths.add(skill.path);
      selected.push(skill);
    }
  }

  for (const name of plainSkillMentions(prompt)) {
    if ((nameCounts.get(name) ?? 0) !== 1) {
      continue;
    }
    const skill = skills.find((candidate) => candidate.name === name);
    if (skill !== undefined && !seenPaths.has(skill.path)) {
      seenPaths.add(skill.path);
      selected.push(skill);
    }
  }

  return selected;
}

function linkedSkillPaths(prompt: string): string[] {
  const paths: string[] = [];
  const pattern = /\[\$([A-Za-z0-9_.:-]+)\]\(([^)]+)\)/g;
  for (const match of prompt.matchAll(pattern)) {
    const path = (match[2] ?? "").trim();
    if (path.endsWith("SKILL.md") || path.startsWith("skill://")) {
      paths.push(path);
    }
  }
  return paths;
}

function plainSkillMentions(prompt: string): string[] {
  const names = new Set<string>();
  const pattern = /(^|[^\w])\$([A-Za-z0-9_.:-]+)/g;
  for (const match of prompt.matchAll(pattern)) {
    const name = match[2] ?? "";
    if (!isCommonEnvironmentVariable(name)) {
      names.add(name);
    }
  }
  return [...names];
}

function canonicalSkillPath(path: string, cwd: string): string {
  const withoutScheme = path.startsWith("skill://")
    ? path.slice("skill://".length)
    : path;
  const absolute = withoutScheme.startsWith("/")
    ? withoutScheme
    : resolve(cwd, withoutScheme);
  try {
    return realpathSync(absolute);
  } catch {
    return resolve(absolute);
  }
}

function isCommonEnvironmentVariable(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

async function runSamplingRequest(
  state: AgentLoopState,
  registry: ToolRegistry,
  options: AgentRunOptions,
): Promise<SamplingResult> {
  throwIfAborted(options.signal);
  const input = modelInput(state, options.history ?? []);
  const response = await options.client.create(input, registry.schemas());
  throwIfAborted(options.signal);
  updateStateFromModelResponse(state, response, options);
  if (!modelNeedsFollowUp(response)) {
    return { needsFollowUp: false };
  }
  const outputs = await executeToolCalls(response.toolCalls, options);
  state.input.push(...outputs);
  return {
    needsFollowUp: true,
    nextInput: state.input,
  };
}

function modelInput(
  state: AgentLoopState,
  history: ModelConversationItem[],
): ModelConversationItem[] {
  if (history.length === 0) {
    return state.input;
  }
  return [...history, ...state.input];
}

function updateStateFromModelResponse(
  state: AgentLoopState,
  response: ModelResponse,
  options: AgentRunOptions,
): void {
  if (response.toolCalls.length > 0) {
    state.input.push({
      type: "assistant_tool_calls",
      toolCalls: response.toolCalls,
    });
  }
  if (response.text) {
    state.finalText = response.text;
    state.input.push({
      type: "message",
      role: "assistant",
      content: response.text,
    });
    options.onEvent?.({ type: "model_text", text: response.text });
  }
  if (response.usage !== undefined) {
    options.onEvent?.({ type: "token_count", usage: response.usage });
  }
}

function modelNeedsFollowUp(response: ModelResponse): boolean {
  return response.toolCalls.length > 0;
}

async function executeToolCalls(
  calls: ModelToolCall[],
  options: AgentRunOptions,
): Promise<ModelConversationItem[]> {
  throwIfAborted(options.signal);
  const outputs = await Promise.all(
    calls.map((call) => executeToolCall(call, options)),
  );
  throwIfAborted(options.signal);
  for (const output of outputs) {
    options.onEvent?.({
      type: "tool_result",
      callId: output.item.call_id,
      name: output.name,
      output: output.output,
    });
  }
  return outputs.map((output) => output.item);
}

async function executeToolCall(
  call: ModelToolCall,
  options: AgentRunOptions,
): Promise<{
  name: string;
  output: string;
  item: { type: "function_call_output"; call_id: string; output: string };
}> {
  options.onEvent?.({
    type: "tool_call",
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
  });
  const args = unknownArgs(call.arguments);
  const context = {
    cwd: options.cwd,
    config: options.config,
    env: options.config.env,
    timeoutMs: options.config.shellTimeoutMs,
  };
  const result = await executeToolInWorker(
    call.name,
    args,
    context,
    options.signal,
  );
  const output = result.output;
  return {
    name: call.name,
    output,
    item: {
      type: "function_call_output",
      call_id: call.callId,
      output,
    },
  };
}
