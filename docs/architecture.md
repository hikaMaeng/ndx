# Architecture

## Modules

- `src/cli.ts`: argument parsing, config load, model client selection, event output.
- `src/config.ts`: JSON settings loader for fixed global settings, nearest project settings, and global search rules.
- `src/protocol.ts`: session, submission, operation, and runtime event contracts shared by CLI, future TUI, and future app-server.
- `src/runtime.ts`: `AgentRuntime` session coordinator. It emits Rust Codex-style session/turn/tool/error events and delegates model/tool execution to the agent loop.
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
2. CLI chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`.
3. CLI creates one `AgentRuntime` session for one-shot or interactive execution.
4. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events.
5. `runAgent` sends the prompt to the model client through the runtime.
6. `ToolRegistry` is built once at startup by scanning task, core, project, global, plugin, and MCP layers.
7. Function schemas from that registry are sent to the model.
8. Every returned tool call is dispatched to its own worker Node process.
9. Filesystem tools are executed from their `tool.json` command process. MCP tools are executed through the configured MCP stdio command. Task tools run inside the worker.
10. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls.

## Runtime Event Contract

The TypeScript runtime intentionally ports the Rust Codex protocol shape before porting the full TUI or app-server. `Submission` carries user turns and interrupts. `RuntimeEvent` carries session configuration, turn lifecycle, model text, tool call/result, token usage, abort, warning, and error messages.

This contract is the stable boundary for upcoming feature branches:

- `codex/model-streaming-provider` will add streaming deltas behind the same event stream.
- `codex/tool-registry-exec` is represented by the TypeScript registry and can grow without changing CLI orchestration.
- `codex/tui-foundation` and `codex/app-server-v2` will consume `AgentRuntime` instead of duplicating agent loop logic.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent command against the `/workspace` volume, then tears compose down.
