# Internals

## Config Loader

`configFiles(cwd)` returns `/home/.ndx/settings.json` followed by the nearest ancestor `.ndx/settings.json` when present. `loadConfig(cwd)` reads those JSON files in order, merges them, then loads `/home/.ndx/search.json` as search rules.

## Settings Merge

Scalar fields such as `model`, `instructions`, `maxTurns`, and `shellTimeoutMs` use last writer wins. `providers`, `permissions`, `websearch`, `mcp`, `keys`, and compatibility `env` are merged by key. `models` are merged by model name.

## Active Provider

`finalizeConfig` resolves `model` to one `models[]` entry, then resolves that entry's `provider` against `providers`. OpenAI-compatible execution reads URL and key from that resolved provider only.

## Tool Loop

`runAgent` builds a `ToolRegistry` once per run and passes the registry's Chat Completions-compatible schemas to every model call. Registry construction scans task, core, project, global, plugin, and MCP layers in priority order. Tool outputs use Responses-style `function_call_output` items internally and are converted to chat completions `role = "tool"` messages by the OpenAI-compatible adapter.

The registry owns only task orchestration tool definitions. Capability tools come from filesystem `tool.json` packages. MCP tools come from project or global settings and are exposed with namespaced names so Chat Completions models can call them without Responses API namespace support.

Every model tool call is sent to `src/tools/worker.ts` as a separate Node process. Filesystem tools then execute their manifest command as another process. Task tools execute inside the worker, never inside the agent process.

## Runtime Session

`AgentRuntime` wraps `runAgent` with a session-oriented protocol. It emits `session_configured` once per runtime instance, then emits `turn_started`, model text, tool call/result, optional token usage, and `turn_complete` for every user prompt. Interrupt submissions emit `turn_aborted`.

Runtime errors are classified into `unauthorized`, `bad_request`, `rate_limited`, `server_error`, `connection_failed`, or `unknown` so future retry and approval flows can be implemented without changing event consumers.

The current interrupt support records and emits the abort contract. It does not yet cancel an in-flight process tree; that belongs to the later execution/permissions branches.

## Session Server

`SessionServer` is the live session authority. It accepts WebSocket JSON-RPC,
creates one `AgentRuntime` per `thread/start`, stores per-thread event history,
maps runtime events to client notifications, and appends server-owned JSONL
records under `<globalDir>/sessions/ts-server`.

The CLI is a client of this server. In normal one-shot and interactive modes it
starts an embedded loopback server and talks to that server over WebSocket. In
`ndx serve` mode it only hosts the server. In `--connect` mode it attaches to an
already-running server.

Client programs may render or cache notifications, but durable session writes
belong to the session server so CLI, TUI, VS Code, and other clients observe the
same source of truth.

## Mock Client

`MockModelClient` emits one `shell` call on the first turn and final text on the second turn. It is intentionally deterministic so Docker verification does not depend on external APIs.

## Docker Context

Docker build does not copy source folders from the local build context. The Dockerfile installs Git, clones `https://github.com/hikaMaeng/ndx.git` at `NDX_GIT_REF` into `/opt/ndx`, then installs dependencies and builds inside the cloned checkout. Compose mounts `./docker/volume/workspace` to `/workspace` and `./docker/volume/home-ndx` to `/home/.ndx` for runtime state.
