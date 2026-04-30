# Internals

## Config Loader

`src/config/index.ts` owns config loading. `configFiles(cwd)` returns
`/home/.ndx/settings.json` followed by the nearest ancestor `.ndx/settings.json`
when present. `loadConfig(cwd)` reads existing JSON files in order, merges them,
fails if neither settings file exists, then loads `/home/.ndx/search.json` as
search rules.

`src/cli/settings-wizard.ts` owns interactive first-run settings creation. When
the CLI is attached to a TTY and `loadConfig` reports missing settings, the
wizard writes `<cwd>/.ndx/settings.json` from permission, provider, model, and
context answers, then the CLI reruns `loadConfig`.

## Settings Merge

Scalar fields such as `model`, `instructions`, `maxTurns`, and `shellTimeoutMs` use last writer wins. `model` may be a string or a role pool object with `session`, `worker`, `reviewer`, and `custom` pools. `providers`, `permissions`, `websearch`, `mcp`, `keys`, and compatibility `env` are merged by key. `models` are merged by model name.

## Active Provider

`finalizeConfig` normalizes `model` into role pools. A string becomes a single-entry `session` pool. `session` is required; `worker`, `reviewer`, and `custom` are optional. Every referenced pool entry must exist in `models[]`, and each model's `provider` must exist in `providers`.

The active root config resolves to the first `session` model for display and provider validation. Sessions keep that base config. `RoundRobinModelRouter` chooses the concrete model per provider request, rotating through `model.session` by default and through a `model.custom.<key>` pool when the current user prompt contains `@key`. Tool follow-up requests keep using the last selected pool for that turn.

`loadConfig` calls `ensureGlobalNdxHome` before reading settings. That installer creates missing global directories and built-in `/core/tools` packages only. It never creates `settings.json`, so model and provider selection must come from a real settings file.

## Model Adapters

`src/model/factory.ts` owns provider selection. The common model contract is the existing `ModelClient` shape: input, tool schemas, then normalized text/tool calls/usage/raw output.

`createRoutedModelClient` wraps provider clients with per-request model routing. The router caches one provider client per concrete model so `/responses` fallback state is scoped to that model endpoint while round-robin counters remain shared by the session server's provider client.

OpenAI provider instances own two adapters. `OpenAiResponsesAdapter` sends `/responses` requests without `previous_response_id`. If `/responses` returns `404` or `405`, `OpenAiResponsesClient` switches that client instance to `OpenAiChatCompletionsAdapter`, which maps `function_call_output` items to tool messages.

`AnthropicMessagesAdapter` maintains volatile Messages history, converts function schemas into Anthropic `tools[]`, converts `tool_use` content blocks into normalized `ModelToolCall`s, and converts `function_call_output` items back into `tool_result` user content blocks.

## Process Library

`src/process/index.ts` is a standalone library. `runProcess` wraps child process spawning, stdout/stderr capture, timeout, and abort handling without importing ndx modules. `TaskQueue` accepts nested serial and parallel plans, creates independent abort controllers per task, and lets task implementations register cancellation hooks. Multiple `TaskQueue` instances can coexist without shared state.

## Tool Loop

`src/agent/loop.ts` owns the model/tool loop. `runAgent` builds a
`ToolRegistry` once per run and passes the registry's Chat
Completions-compatible schemas to every model call. Registry construction scans
task, core, project, global, plugin, and MCP layers in priority order. The loop
keeps a local request stack for the active user turn and sends the full stack on
every sampling request. Tool outputs use Responses-style
`function_call_output` items internally and are converted to chat completions
`role = "tool"` messages by the OpenAI-compatible adapter.

The registry owns only task orchestration tool definitions. Capability tools come from filesystem `tool.json` packages. MCP tools come from project or global settings and are exposed with namespaced names so Chat Completions models can call them without Responses API namespace support.

Every model tool call is sent through `src/process/runProcess` to
`src/session/tools/worker.ts` as a separate Node process. Filesystem tools then
execute their manifest command through the same process library. Task,
input, planning, and collaboration tools belong under the session-owned
`src/session/tools/` tree because they mutate session task state. Built-in
capability tools such as shell, patch, filesystem, web, image, discovery, and
permission stubs are external `/core/tools` packages. Task tools execute
inside the worker, never inside the agent process.

Abort propagation crosses the same boundary. `AgentRuntime` owns the turn
`AbortController`, `executeToolInWorker` attaches it to the worker process, and
the worker relays `SIGINT` or `SIGTERM` into a local `AbortSignal` passed through
`ToolRegistry.execute`. External tool commands receive that signal through
`runProcess`, so an interrupted turn cancels the worker and the manifest command
instead of leaving the capability process detached.

## Runtime Session

`src/runtime/runtime.ts` owns turn coordination. `AgentRuntime` wraps `runAgent`
with a session-oriented protocol. It emits `session_configured` once per runtime
instance, then emits `turn_started`, model text, tool call/result, optional
token usage, and `turn_complete` for every user prompt. Interrupt submissions
emit `turn_aborted`.

Runtime errors are classified into `unauthorized`, `bad_request`, `rate_limited`, `server_error`, `connection_failed`, or `unknown` so future retry and approval flows can be implemented without changing event consumers.

Interrupt support records and emits the abort contract and cancels in-flight
worker plus external manifest command processes. Full process-tree cleanup below
the manifest command remains owned by the capability tool implementation.

## Session Server

`src/session/server.ts` owns live sessions. `SessionServer` accepts WebSocket
JSON-RPC, creates one `AgentRuntime` per live session, stores per-session event
history, maps runtime events to client notifications, and enqueues server-owned
JSONL records under `<globalDir>/sessions/ts-server`.

`session/list` scans the same JSONL directory and merges matching persisted live
sessions with saved records for a requested resolved `cwd`. Workspace numbers
are monotonically increasing sequence values assigned on the first user prompt,
not temporary list indexes. `session/restore` reloads saved runtime events,
rebuilds model conversation history from prior user turns, assistant messages,
tool calls, and tool results, creates an `AgentRuntime` with the original
session id, and claims the session owner file. `session/delete`
removes a non-current session's JSONL and owner files. A server that still holds
the deleted session checks for the missing JSONL when it receives a prompt and
when a response reaches a terminal event; if missing, it emits
`session/deleted`, closes socket clients, and terminates.

Session owner files are serialized with a sibling `.lock` directory. A server
that finds the owner file locked waits briefly and retries instead of reading
or replacing the owner file during another server's claim. Stale owner locks are
removed after the configured stale window so a crashed claimant does not block
future restore or prompt attempts indefinitely.

`turn/start` flushes the session start and turn start records before the
runtime is scheduled. The response still returns before model completion, but a
fast model response cannot be mistaken for a deleted session just because the
JSONL writer has not created the file yet.

Server shutdown sends WebSocket close frames and then destroys the upgraded
sockets. Tests and short-lived CLI clients must not wait indefinitely for peer
close handshakes when a session server is being torn down.

The CLI is a client of this server. In normal one-shot and interactive modes it
starts an embedded loopback server and talks to that server over WebSocket. In
`ndx serve` mode it only hosts the server. In `--connect` mode it attaches to an
already-running server.

Client programs may render or cache notifications, but durable session writes
belong to the session server so CLI, TUI, VS Code, and other clients observe the
same source of truth.

`SessionLogStore` keeps persistence work off the session request path. It owns
an in-memory FIFO queue, one in-flight job, and an IPC child process. The child
process writes JSONL, adds `persistedAt` and `writerPid`, and reports result
events. The parent retries failed writes three times and logs drops instead of
crashing the server.

Socket close is also a persistence boundary. When a connection disappears and a
persisted session has no subscribers left, the server records
`session_detached` and drains the queue. Empty sessions are ignored because they
have no durable identity yet.

## Mock Client

`MockModelClient` emits one `shell` call on the first turn and final text on the second turn. It is intentionally deterministic so Docker verification does not depend on external APIs.

## Docker Context

Docker build does not copy source folders from the local build context. The Dockerfile installs Git, clones `https://github.com/hikaMaeng/ndx.git` at `NDX_GIT_REF` into `/opt/ndx`, then installs dependencies and builds inside the cloned checkout. Compose mounts `./docker/volume/workspace` to `/workspace` and `./docker/volume/home-ndx` to `/home/.ndx` for runtime state.
