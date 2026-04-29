# Architecture

## Source Layout

Top-level `src` contains role folders only.

| Folder         | Role                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `src/cli/`     | CLI entrypoint, argument parsing, session-client controller, command UI.    |
| `src/config/`  | JSON settings discovery, merge, and active provider resolution.             |
| `src/model/`   | Model client implementations and test model client.                         |
| `src/process/` | Dependency-free process runner and instantiable serial/parallel task queue. |
| `src/agent/`   | Model/tool sampling loop.                                                   |
| `src/runtime/` | Turn coordinator, abort helpers, provider error classification.             |
| `src/session/` | WebSocket session server/client, JSONL persistence, model tool execution.   |
| `src/shared/`  | Cross-module protocol and runtime data contracts.                           |

`src/session/tools/` is intentionally nested under `session`. It contains the
tool registry, worker process launcher, built-in task tools, external `tool.json`
adapter, and MCP adapter used by session turns. There is no top-level `src/tools`
domain.

## Runtime Flow

1. CLI resolves `cwd` and reads `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`. The config loader bootstraps missing required global `.ndx` elements.
2. CLI prints the configured robot startup art, then starts or connects to a WebSocket session server. `ndx serve` keeps that server running; normal one-shot and interactive CLI modes use an embedded loopback server.
3. Session server startup re-checks required global `.ndx` elements and installs any missing settings, core directories, shell tool files, and skills directory before accepting session work.
4. The CLI is a session-server client. `CliSessionController` sends `initialize`, starts one thread, tracks socket/server/thread status, receives notifications, and prints selected initialization, tool, warning, and final events.
5. The session server chooses `MockModelClient` for `--mock`, otherwise creates the configured provider client, and creates one `AgentRuntime` per live thread.
6. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events into the server.
7. The session server enqueues thread, request, runtime-event, and notification records for JSONL persistence under `<globalDir>/sessions/ts-server`.
8. The session server broadcasts notifications to subscribed WebSocket clients. CLI, TUI, VS Code, and other UIs are peers on this boundary.
9. `runAgent` sends the prompt to the model client through the runtime.
10. `ToolRegistry` is built once at startup by scanning task, core, project, global, plugin, and MCP layers.
11. Function schemas from that registry are sent to the model.
12. Every returned tool call is dispatched through the shared process runner to its own worker Node process.
13. Filesystem tools are executed from their `tool.json` command process. MCP tools are executed through the configured MCP stdio command. Task tools run inside the worker.
14. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls. Provider adapters translate those items to Responses, Chat Completions, or Anthropic Messages wire shapes.

## Runtime Event Contract

The TypeScript runtime exposes the ndx protocol behind a WebSocket session server. `Submission` carries user turns and interrupts. `RuntimeEvent` carries session configuration, turn lifecycle, model text, tool call/result, token usage, abort, warning, and error messages.

The server translates runtime events into JSON-RPC notifications:

- `thread/started`
- `thread/sessionConfigured`
- `turn/started`
- `item/toolCall`
- `item/toolResult`
- `item/agentMessage`
- `thread/tokenUsage/updated`
- `turn/completed`
- `turn/aborted`
- `warning`
- `error`

Client programs must not maintain authoritative live session or persistence state. They may cache what they receive, but the server is the owner of live thread state and durable JSONL. Session initialization detail is displayed by the CLI and kept in client-local status/history only; it is not sent back as prompt context.

`initialize` responses and `thread/sessionConfigured` events include a bootstrap report. The report lists each required `.ndx` element, absolute path, and whether it already existed or was installed during startup.

## CLI Client Boundary

`src/cli/session-client.ts` owns CLI-only session behavior:

- configured robot startup art and socket initialization display
- thread start status display
- `/status`, `/init`, `/events`, and `/interrupt`
- runtime notification formatting for human output

The CLI does not inspect `.ndx` directly after config loading and does not persist live session state. Future server-side initialization detail should arrive through notifications or initialize responses and be rendered by this controller without changing the model prompt.

## Persistence Queue

The session server never performs JSONL filesystem IO on the request path. It
pushes records into `SessionLogStore`. When the queue transitions from idle to
non-empty, the store starts `session-log-writer` as a child process, sends one
job over IPC, waits for a result event, then sends the next job. Failed jobs are
retried up to three attempts, then dropped with a server-side error log so the
main session process stays alive.

When a WebSocket connection closes without an explicit session shutdown, the
server removes that connection from thread subscriber sets. If a thread has no
remaining subscribers, the server enqueues a `thread_detached` record and
triggers a queue drain. In-flight turns can still finish and enqueue their final
runtime events because the live thread remains in server memory.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent command against the `/workspace` volume, then tears compose down.
