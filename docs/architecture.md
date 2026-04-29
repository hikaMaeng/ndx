# Architecture

## Source Layout

Top-level `src` contains role folders only.

| Folder         | Role                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `src/cli/`     | CLI entrypoint, argument parsing, session client wiring.             |
| `src/config/`  | JSON settings discovery, merge, and active provider resolution.      |
| `src/model/`   | Model client implementations and test model client.                  |
| `src/agent/`   | Model/tool sampling loop.                                            |
| `src/runtime/` | Turn coordinator, abort helpers, provider error classification.      |
| `src/session/` | WebSocket session server/client plus JSONL persistence queue/writer. |
| `src/shared/`  | Cross-module protocol and runtime data contracts.                    |
| `src/tools/`   | Tool registry, worker process launcher, built-in task tools, MCP.    |

## Runtime Flow

1. CLI resolves `cwd` and reads `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`.
2. CLI starts or connects to a WebSocket session server. `ndx serve` keeps that server running; normal one-shot and interactive CLI modes use an embedded loopback server.
3. The CLI acts as a client: it sends `thread/start` and `turn/start` requests, receives notifications, and prints selected tool/final events.
4. The session server chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`, and creates one `AgentRuntime` per live thread.
5. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events into the server.
6. The session server enqueues thread, request, runtime-event, and notification records for JSONL persistence under `<globalDir>/sessions/ts-server`.
7. The session server broadcasts notifications to subscribed WebSocket clients. CLI, TUI, VS Code, and other UIs are peers on this boundary.
8. `runAgent` sends the prompt to the model client through the runtime.
9. `ToolRegistry` is built once at startup by scanning task, core, project, global, plugin, and MCP layers.
10. Function schemas from that registry are sent to the model.
11. Every returned tool call is dispatched to its own worker Node process.
12. Filesystem tools are executed from their `tool.json` command process. MCP tools are executed through the configured MCP stdio command. Task tools run inside the worker.
13. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls.

## Runtime Event Contract

The TypeScript runtime ports the Rust Codex protocol shape behind a WebSocket session server. `Submission` carries user turns and interrupts. `RuntimeEvent` carries session configuration, turn lifecycle, model text, tool call/result, token usage, abort, warning, and error messages.

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

Client programs must not maintain authoritative live session or persistence state. They may cache what they receive, but the server is the owner of live thread state and durable JSONL.

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
