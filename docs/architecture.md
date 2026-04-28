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
- `src/tools/registry.ts`: Rust Codex-style tool registry for built-in, MCP, and plugin tools.
- `src/tools/local/`: shell, shell_command, exec_command, and write_stdin execution.
- `src/tools/filesystem/`: list_dir and view_image tools.
- `src/tools/mcp/`: configured MCP tool, resource, and stdio call support.
- `src/tools/plugins/`: configured plugin tool schema and command execution.
- `src/tools/worker.ts` and `src/tools/process-runner.ts`: isolated Node worker process execution for parallel-safe tool batches.
- `src/tools/patch/`, `src/tools/planning/`, `src/tools/input/`, `src/tools/permissions/`: apply_patch, update_plan, request_user_input, and request_permissions parity tools.
- `src/types.ts`: shared runtime contracts.

## Runtime Flow

1. CLI resolves `cwd` and reads `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`.
2. CLI chooses `MockModelClient` for `--mock`, otherwise `OpenAiResponsesClient`.
3. CLI creates one `AgentRuntime` session for one-shot or interactive execution.
4. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events.
5. `runAgent` sends the prompt to the model client through the runtime.
6. Function calls are dispatched through `ToolRegistry`.
7. If all tool calls in the batch are parallel-safe, `runAgent` starts one worker Node process per call.
8. Mixed or sessionful tool batches run sequentially in the parent process.
9. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls.

## Runtime Event Contract

The TypeScript runtime intentionally ports the Rust Codex protocol shape before porting the full TUI or app-server. `Submission` carries user turns and interrupts. `RuntimeEvent` carries session configuration, turn lifecycle, model text, tool call/result, token usage, abort, warning, and error messages.

This contract is the stable boundary for upcoming feature branches:

- `codex/model-streaming-provider` will add streaming deltas behind the same event stream.
- `codex/tool-registry-exec` is represented by the TypeScript registry and can grow without changing CLI orchestration.
- `codex/tui-foundation` and `codex/app-server-v2` will consume `AgentRuntime` instead of duplicating agent loop logic.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent command against the `/workspace` volume, then tears compose down.
