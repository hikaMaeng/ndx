# Agent Loop

This document records the TypeScript agent loop contract implemented by
`src/agent.ts`, `src/runtime.ts`, and `src/tools/process-runner.ts`.

This is not the full Rust Codex session architecture. The TypeScript runtime
currently ports the sampling/tool loop and a small session event shell. Rust
Codex also has live `CodexThread` objects, rollout JSONL persistence, global
prompt history JSONL, app-server thread subscriptions, and WebSocket/remote
control delivery. Those are documented in `codex-rs/core/docs/agent-loop.md`;
the TypeScript implementation does not yet provide equivalent durable or remote
subscription layers.

## Loop State

`runAgent` owns a small loop state:

- `input`: the next model input. It starts as the user prompt and becomes the
  ordered `function_call_output` list after tool execution.
- `previousResponseId`: the last model response id, kept so the model provider
  can continue the prior response chain.
- `finalText`: the latest non-empty model text, returned when the model stops
  requesting tools.

The loop runs at most `config.maxTurns` sampling requests. If every sampling
request returns tool calls, the loop exits with
`agent stopped after max_turns=<value>`.

`AgentRuntime` owns only a live in-process session shell:

- `sessionId`: emitted with every runtime event;
- `activeTurn`: current turn id plus `AbortController`;
- `abortedTurnIds`: duplicate-abort guard.

There is no live thread registry, no resumeable thread handle, no mailbox, no
status watch receiver, and no persisted active-turn state in the TypeScript
runtime.

## Exit Conditions

The normal exit condition is algorithmic: a model response with an empty
`toolCalls` array means no follow-up input is required, so `finalText` is
returned.

The abnormal exit conditions are:

- the configured turn budget is exhausted;
- model, schema, or tool execution throws;
- the active `AbortSignal` is aborted before or after model/tool await points.

## Async Task Waiting

Tool calls from one model response are launched with `Promise.all`. This keeps a
single sampling request blocked until every tool result in that batch resolves,
and preserves the model-visible output order by mapping the settled results back
to the original call order.

Each tool call is executed in a separate worker Node process. The parent process
waits for worker stdout and process close, then parses the final JSON response
line.

## Tool Dependence

The model decides whether to continue by emitting tool calls. The TypeScript loop
does not infer a task graph from the prompt. It only tracks the executable loop
state, executes the model-requested calls against the registry, and feeds the
structured outputs back as the next model input.

The registry resolves tools from task, core, project, global, plugin, and MCP
layers. Unsupported tool names return a tool output rather than mutating loop
control directly.

## Prompt Injection Markers

The loop has no parser for user-inserted markers such as `<system-remainder>`.
The user prompt is passed as initial model input. Any special interpretation of
prompt text must come from the model provider or a future explicit prompt
assembly layer, not from the current TypeScript loop.

## Context Management

The loop currently has no separate context compaction or truncation intervention
point. It preserves `previousResponseId` and submits the next input to the model
client. Provider-side continuation and any model-client request shaping are
outside the loop state machine.

`OpenAiResponsesClient` keeps chat messages in memory for the life of one client
instance. It starts with `config.instructions` as a `system` message, appends
string input as a `user` message, and appends function outputs as `tool`
messages. This volatile message list is the current TypeScript context.

The TypeScript runtime does not write rollout JSONL, does not write
`history.jsonl`, does not back thread metadata with SQLite, and cannot rebuild
turns from persisted `RolloutItem` records.

## Hooks And Events

The hook surface is the `onEvent` callback:

- `model_text`: emitted after a response contains text;
- `token_count`: emitted after usage appears on a response;
- `tool_call`: emitted before each tool worker starts;
- `tool_result`: emitted after the tool batch resolves.

`AgentRuntime` maps these internal events to protocol events for the active turn.
Runtime interruption owns an `AbortController`; the signal is passed through to
the loop and worker launcher. Interrupts emit `turn_aborted` once per turn and
prevent `turn_complete`.

The event path is callback-only. There is no app-server listener task, no
connection/thread subscription map, and no WebSocket or VS Code extension
delivery path in this TypeScript runtime.
