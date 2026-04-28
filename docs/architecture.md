# Architecture

## Modules

- `src/cli.ts`: argument parsing, config load, model client selection, event output.
- `src/config.ts`: JSON settings loader for fixed global settings, nearest project settings, and global search rules.
- `src/protocol.ts`: session, submission, operation, and runtime event contracts shared by CLI, future TUI, and future app-server.
- `src/runtime.ts`: `AgentRuntime` turn coordinator. It emits Rust Codex-style session/turn/tool/error events and delegates model/tool execution to the agent loop.
- `src/session-server.ts`: WebSocket JSON-RPC session core. It owns live threads, client subscriptions, runtime event broadcast, and server-side JSONL persistence.
- `src/session-client.ts`: JSON-RPC WebSocket client used by the CLI and tests. It does not persist session state.
- `src/errors.ts`: provider error classification used by runtime error events.
- `src/agent.ts`: Responses-style model/tool loop.
- `src/openai.ts`: OpenAI-compatible chat completions adapter and response normalization.
- `src/mock-client.ts`: deterministic model client for Docker and unit tests.
- `src/tools/registry.ts`: startup tool discovery, priority resolution, and task-tool registration.
- `src/tools/external/`: `tool.json` manifest loading and command process execution.
- `src/tools/mcp/`: configured MCP tool, resource, and stdio call support.
- `src/tools/worker.ts` and `src/tools/process-runner.ts`: one isolated Node worker process per model tool call.
- `src/tools/planning/`, `src/tools/input/`, `src/tools/collaboration/`: task orchestration tools that cannot be externalized.
- `src/types.ts`: shared runtime contracts.

## Runtime Flow

1. CLI resolves `cwd` and reads `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`.
2. CLI starts or connects to a WebSocket session server. `ndx serve` keeps that server running; normal one-shot and interactive CLI modes use an embedded loopback server.
3. The CLI acts as a client: it sends `thread/start` and `turn/start` requests, receives notifications, and prints selected tool/final events.
4. The session server chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`, and creates one `AgentRuntime` per live thread.
5. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events into the server.
6. The session server appends thread, request, runtime-event, and notification records to JSONL under `<globalDir>/sessions/ts-server`.
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

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent command against the `/workspace` volume, then tears compose down.
