# Agent Loop

This document records the TypeScript agent loop contract implemented by
`src/agent/loop.ts`, `src/runtime/runtime.ts`, `src/session/server.ts`, and
`src/session/tools/process-runner.ts`.

This is the TypeScript ndx session architecture. It
now follows the same ownership split: the agent loop executes one model/tool
turn, `AgentRuntime` converts it into session events, and `SessionServer` owns
live sessions, WebSocket subscriptions, and SQLite persistence.

## Loop State

`runAgent` owns a small loop state:

- `input`: the next model input. It starts as the user prompt and becomes the
  ordered local client-side stack for the current turn, including assistant
  tool calls and `function_call_output` items after tool execution.
- `finalText`: the latest non-empty model text, returned when the model stops
  requesting tools.

The loop runs at most `config.maxTurns` sampling requests. If every sampling
request returns tool calls, the loop exits with
`agent stopped after max_turns=<value>`.

`AgentRuntime` owns one turn-oriented runtime shell:

- `sessionId`: emitted with every runtime event;
- `activeTurn`: current turn id plus `AbortController`;
- `abortedTurnIds`: duplicate-abort guard.

`SessionServer` owns the live session system:

- `sessions`: live session registry keyed by runtime `sessionId`;
- `subscribers`: WebSocket clients subscribed to each session;
- `events`: server-held runtime event history for `session/read`;
- `status`: session status derived from runtime events;
- `SqliteSessionStore`: account, project, session, event, and owner rows in
  `<dataDir>/ndx.sqlite`.

The CLI is not the session owner. Normal one-shot and interactive CLI modes
start an embedded loopback WebSocket server and then act as a client. `ndx
serve` exposes the same server for other clients.

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

The inner loop receives the already-projected conversation stack from the
session server. For saved sessions the server rebuilds that stack from SQLite
before each new prompt, applying `/compact` first and `/lite` second.
`AgentRuntime` can report the live stack by item kind for `/context` and for
the before/after sections printed by `/compact` and `/lite`. During a single
active turn, tool calls and tool results remain in the loop's local follow-up
context so tool execution can complete normally. Provider-side continuation is
intentionally unused.

OpenAI-compatible providers first use Responses without `previous_response_id`.
When `/responses` is unavailable, the client falls back to Chat Completions and
converts the same local stack into chat messages. Anthropic providers convert
the same local stack into Messages requests. In every case, provider-specific
wire shapes stay inside the adapter.

`SessionServer` writes server-owned SQLite records for session creation,
subscription, turn requests, runtime events, outbound notifications, ownership,
and connection detach. This is ndx session persistence recovery: the server
does not write `history.jsonl` and does not depend on provider-side persisted
`RolloutItem` records.

## Hooks, Events, And Socket Delivery

The inner hook surface is the `onEvent` callback:

- `model_text`: emitted after a response contains text;
- `token_count`: emitted after usage appears on a response;
- `tool_call`: emitted before each tool worker starts;
- `tool_result`: emitted after the tool batch resolves.

`AgentRuntime` maps these internal events to protocol events for the active turn.
Runtime interruption owns an `AbortController`; the signal is passed through to
the loop and worker launcher. Interrupts emit `turn_aborted` once per turn and
prevent `turn_complete`.

`SessionServer` is the external hook point. It maps runtime events to
JSON-RPC-style notifications, persists them, and sends them to subscribed
WebSocket clients. UI clients such as CLI, TUI, or VS Code should consume this
socket stream rather than attaching their own durable session writers.

Persistence is event driven. Queue insertion is synchronous and cheap; the
worker process performs `mkdir` and `appendFile`. Success advances the queue,
failure retries the job, and repeated failure drops only that persistence job
with an error log.
