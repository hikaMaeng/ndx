# Constraints

## Config

- Global settings path is fixed at `/home/.ndx/settings.json`.
- Project settings path is `.ndx/settings.json` under the nearest ancestor project directory.
- No runtime environment variable is used to select model, provider URL, provider key, or ndx home.
- Settings are JSON only; `config.toml`, `.codex`, `NDX_HOME`, `NDX_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` are not part of the ndx TypeScript loader contract.
- `keys` values must be strings because they are injected into external tool process environments.
- Provider `key` may be an empty string.
- Provider `type` is limited to `openai` and `anthropic`.
- Unknown JSON object fields are preserved only where the runtime type allows extension, such as `websearch`, `mcp`, and `search`.
- The global `.ndx` directory is self-healing at startup for required defaults: missing `settings.json` and `/core/tools/shell` are installed before config parsing continues.

## Search

- Web-search credentials live in `settings.json` under `websearch`.
- Web-search parsing and interpretation rules live in global `/home/.ndx/search.json`.
- Web-search is not agent-built-in. Provide it as an external `tool.json` package when needed.

## Tool System

- The agent body owns only task orchestration tools. Capability tools such as shell, patch, filesystem, web, image, and plugin tools must be external packages.
- Filesystem tools must live under one of the documented layer directories and must include `tool.json`.
- Tool folder name must equal the OpenAI function `name`.
- Tool manifests must include an OpenAI function schema plus command execution fields.
- The command execution field set is `command`, optional `args`, optional `cwd`, optional `env`, and optional `timeoutMs`.
- Every model tool call runs in a separate worker Node process. No capability tool executes inside the agent process.
- Multiple tool calls in one model response are launched in parallel. Sequential behavior is achieved by model turns queuing later asynchronous calls.
- The default tool timeout is `shellTimeoutMs` from settings unless a tool manifest declares `timeoutMs`.

## Model Providers

- Real model execution uses the active model's provider from `settings.json`.
- OpenAI-compatible execution uses Responses first. `404` and `405` from `/responses` permanently switch that client instance to Chat Completions fallback.
- Anthropic execution uses Messages and converts OpenAI-style function schemas to Anthropic tool schemas.
- The agent loop only sees normalized function tool calls and `function_call_output` items. Provider-specific content blocks do not leak into `src/agent`.
- Native Responses-only `namespace`, freeform, local_shell, and image_generation tool types are represented as function-compatible TypeScript contracts.
- Multi-agent and agent-job task tools are exposed for Rust Codex schema parity but return unavailable until corresponding TypeScript task backends exist.

## Process Library

- `src/process/` must not import ndx config, session, tool, model, or runtime modules.
- `TaskQueue` instances are independent. There is no global queue singleton.
- Queue plans may nest `{ "serial": [...] }` and `{ "parallel": [...] }` nodes.
- Cancellation is delivered through `AbortSignal` plus per-task cancellation hooks.

## MCP And Plugins

- Project MCP settings have higher priority than global MCP settings.
- MCP command servers are queried with `tools/list` at startup. Static `tools[]` entries remain supported for servers that cannot be queried during tests or offline runs.
- Plugin tools are discovered from filesystem plugin layer directories, not from `settings.json` plugin entries.

## Browser Markup

No frontend view is rendered by this package. Browser locator contracts are not applicable.
