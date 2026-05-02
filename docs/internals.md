# Internals

## Config Loader

`src/config/index.ts` owns config loading. `configFiles(cwd)` returns
`/home/.ndx/settings.json` followed by the current project `.ndx/settings.json`
when present. `loadConfig(cwd)` reads existing JSON files in order, merges them,
fails if neither settings file exists, then loads `/home/.ndx/search.json` as
search rules.

Each settings file carries a `"version"` equal to the installed package version.
`loadConfig` updates only that field when the file is otherwise readable and
valid for the current cascade.

`src/cli/settings-wizard.ts` owns interactive first-run settings creation and
repair. When the CLI is attached to a TTY and `loadConfig` reports missing or
incomplete settings, the wizard writes or repairs `/home/.ndx/settings.json`
first from permission, provider, model, and context answers, then repairs the
current project `.ndx/settings.json` when it exists. The CLI then reruns
`loadConfig`.

## Settings Merge

Scalar fields such as `model`, `dataPath`, `sessionPath`, `instructions`, `maxTurns`, and `shellTimeoutMs` use last writer wins. `model` may be a string or a role pool object with `session`, `worker`, `reviewer`, and `custom` pools. `providers`, `permissions`, `websearch`, `mcp`, `keys`, and compatibility `env` are merged by key. `models` may be an array or an object keyed by local model ID and are merged by that ID.

## Active Provider

`finalizeConfig` normalizes `model` into role pools. A string becomes a single-entry `session` pool. `session` is required; `worker`, `reviewer`, and `custom` are optional. Every referenced pool entry must exist in the normalized model catalog, and each model's `provider` must exist in `providers`.

The active root config resolves to the first `session` model for display and provider validation. Sessions keep that base config. `RoundRobinModelRouter` now binds each selected pool to one model for the live session. `@key` prompts select `model.custom.<key>` and tool follow-up requests keep using that pool. Explicit `/model` changes update `config.model`, `activeModel`, effort, and thinking state; the next provider request uses a new provider-client cache key when those values change.

`loadConfig` calls `ensureGlobalNdxHome` before reading settings. That installer creates missing global system directories and built-in `/system/tools` packages only. It never creates model/provider settings, so model and provider selection must come from a real settings file or the TTY wizard.

## Model Adapters

`src/model/factory.ts` owns provider selection. The common model contract is the existing `ModelClient` shape: input, tool schemas, then normalized text/tool calls/usage/raw output.

`createRoutedModelClient` wraps provider clients with sticky model routing. The router caches provider clients by model ID plus active effort, thinking, and sampling parameters so `/responses` fallback state is scoped to that provider-client binding.

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
permission stubs are external `/system/tools` packages. Task tools execute
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
history, maps runtime events to client notifications, and stores server-owned
records in `<dataDir>/ndx.sqlite`. The default data directory is
`/home/.ndx/system`; `dataPath` overrides it and legacy `sessionPath` is accepted
as the same override. Missing user defaults to `defaultUser`.

`session/list` scans SQLite and merges matching persisted live
sessions with saved records for a requested user and resolved `cwd`. Workspace numbers
are monotonically increasing sequence values assigned on the first user prompt,
not temporary list indexes. `session/restore` reloads saved runtime events,
rebuilds model conversation history from prior user turns, assistant messages,
tool calls, and tool results, creates an `AgentRuntime` with the original
session id, and claims the session owner row. `session/delete` marks a
non-current session deleted and clears its owner row. A server that still holds
the deleted session checks SQLite when it receives a prompt and when a response
reaches a terminal event; if deleted, it emits
`session/deleted`, closes socket clients, and terminates.

Session ownership uses `session_owners` rows. A server replaces the owner row
when it restores or starts a prompt. A stale owner discards in-flight output if
another server claimed the row before completion.

`turn/start` creates the durable session row and turn-start event before the
runtime is scheduled. The response still returns before model completion.

Server shutdown sends WebSocket close frames and then destroys the upgraded
sockets. Tests and short-lived CLI clients must not wait indefinitely for peer
close handshakes when a session server is being torn down.

The CLI is a client of this server. In normal one-shot and interactive modes it
uses the current folder as the session `cwd`, starts a loopback server when the
requested socket is unavailable, and talks to that server over WebSocket. In
`ndx serve` or `ndxserver` mode it only hosts the server. In `--connect` mode it
attaches to an already-running server.

Client programs may render or cache notifications, but durable session writes
belong to the session server so CLI, TUI, VS Code, and other clients observe the
same source of truth.

`SqliteSessionStore` owns schema initialization, default account creation,
account password checks, session rows, event append, soft delete, and ownership
claiming. It enables WAL, foreign keys, and a busy timeout for concurrent
socket-server processes.

Socket close is also a persistence boundary. When a connection disappears and a
persisted session has no subscribers left, the server records
`session_detached`. Empty sessions are ignored because they have no durable
identity yet.

The account methods are in-process JSON-RPC controls for the current service
instance: `account/create`, `account/login`, `account/delete`, and
`account/changePassword`. `initialize`, `account/create`, and `account/login`
are public. Other socket methods require a successful login on the WebSocket
connection. Login stores user and client id on the connection. The first CLI
client implemented here generates a fresh client id per controller instance,
logs in as `defaultUser` with an empty password, and includes user/client id in
session and turn requests.

HTTP `GET /` and `GET /dashboard` on the separate dashboard listener render the
server dashboard. `POST /api/reload` re-runs global `.ndx` bootstrap and
reloads settings plus discovered `AGENTS.md` sources for later sessions.
`POST /api/exit` requests shutdown of the local server instance. The dashboard
has no authentication or authorization; agent interaction remains on
authenticated WebSocket JSON-RPC.

## Mock Client

`MockModelClient` emits one `shell` call on the first turn and final text on the second turn. It is intentionally deterministic so Docker verification does not depend on external APIs.

## Docker Context

Docker build creates only the tool sandbox image. It installs the shell/runtime
utilities needed by core external tools and keeps `/workspace` as the mounted
project directory. Compose mounts `./docker/volume/workspace` to `/workspace`.
The live server manages tool containers by resolved physical project folder,
stores that path in Docker labels, and reuses the labeled running container
instead of creating another one for the same folder.
On startup, a sandboxed server removes existing containers labeled as ndx
server-owned tool sandboxes before creating the current workspace sandbox.
The ndx server is a local process and owns session state outside Docker.
