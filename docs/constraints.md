# Constraints

## Config

- Global settings path is fixed at `/home/.ndx/settings.json`.
- The data directory is `/home/.ndx/system` unless settings define optional
  `dataPath`. Legacy `sessionPath` is accepted as a data-directory override.
- Account, project, session, event, and ownership records are stored in
  `<dataDir>/ndx.sqlite`; omitted user means `defaultUser`.
- Project settings path is `.ndx/settings.json` under the nearest ancestor project directory.
- No runtime environment variable is used to select model, provider URL, provider key, or ndx home.
- Settings are JSON only; `config.toml`, `.codex`, `NDX_HOME`, `NDX_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` are not part of the ndx TypeScript loader contract.
- `keys` values must be strings because they are injected into external tool process environments.
- Provider `key` may be an empty string.
- Provider `type` is limited to `openai` and `anthropic`.
- `model` may be a string or an object with `session`, optional `worker`, optional `reviewer`, and optional `custom` model pools.
- `model.session` is required for object form. A live session keeps sticky model bindings per selected pool; model, effort, thinking, or pool changes are explicit prefix-cache boundaries.
- `model.worker` and `model.reviewer` are parsed and validated only; no runtime dispatch path consumes them yet.
- `model.custom` keys are selected by `@key` in the user prompt. Keys must be non-empty and must not contain whitespace or `@`.
- `models` may be a legacy array or an object keyed by local model ID. Object keys are the pool-facing aliases; `models.<id>.name` is the provider-facing model name.
- `models.<id>.effort` and `models.<id>.think` declare whether `/effort` and `/think` can change that model's live session state.
- A model with `effort` but no active effort starts at the middle configured
  effort entry. A model with `think` starts with thinking mode on. Explicit
  model changes reset both controls to those defaults.
- Unknown JSON object fields are preserved only where the runtime type allows extension, such as `websearch`, `mcp`, and `search`.
- The global `.ndx/system` directory is self-healing at startup for required directories and built-in `/system/core/tools` packages.
- `/home/.ndx/system` bootstrap information remains code-managed and is not stored in SQLite.
- The config loader itself does not generate settings files. TTY CLI startup handles missing global and project settings by asking setup questions and writing project `.ndx/settings.json`; non-TTY loading still fails before model selection.

## Host CLI State

- Host CLI app state is separate from `/home/.ndx` and project `.ndx`.
- `NDX_CLI_STATE_DIR` overrides the app-state directory.
- `auth.json` contains one shared last-login value for all host CLI instances.
- Managed Docker compose files live under `/home/.ndx/system/managed`.
- `clientId` is never persisted as the last-login identity; each CLI or plugin
  runtime instance owns its own client id.

## Repository Shape

- The root package is the only package in this repository.
- Source, tests, docs, and Docker deploy files are the maintained workspace
  boundary.
- SDK, Bazel, devcontainer, release-announcement, and third-party vendor trees
  are not part of the maintained ndx TypeScript workspace.
- `docker/volume` may contain local runtime output, but only `.gitkeep` anchors
  are tracked there.

## Server Ports And Auth

- `ndx serve` and `ndxserver` expose two ports: WebSocket JSON-RPC and HTTP dashboard.
- Docker compose must publish both ports. Defaults are socket `45123` and
  dashboard `45124`; the two listeners are separate and must not be configured
  to the same container port.
- The default compose command must start the long-running `ndxserver` service.
- The dashboard has no authentication or authorization.
- WebSocket methods other than `initialize`, `account/create`,
  `account/login`, and `account/socialLogin` require successful account login
  on that connection.
- Password authentication checks username and password. Social authentication
  validates the supplied access token against the provider profile endpoint and
  maps the account to `provider:subject`.
- The authenticated WebSocket connection user is authoritative for later
  session, command, and turn requests.
- Authorization beyond user-scoped session filtering is not implemented yet.

## Search

- Web-search credentials live in `settings.json` under `websearch`.
- Web-search parsing and interpretation rules live in global `/home/.ndx/search.json`.
- Web-search is not agent-built-in. Provide it as an external `tool.json` package when needed.

## Tool System

- The agent body owns only task orchestration tools. Capability tools such as shell, patch, filesystem, web, image, and plugin tools must be external packages.
- Built-in core capability packages currently include `shell`, `apply_patch`, `list_dir`, `view_image`, `web_search`, `image_generation`, `tool_suggest`, `tool_search`, and `request_permissions`.
- Filesystem tools must live under one of the documented layer directories and must include `tool.json`.
- Tool folder name must equal the OpenAI function `name`.
- Tool manifests must include an OpenAI function schema plus command execution fields.
- The command execution field set is `command`, optional `args`, optional `cwd`, optional `env`, and optional `timeoutMs`.
- Every model tool call runs in a separate worker Node process. No capability tool executes inside the agent process.
- Multiple tool calls in one model response are launched in parallel. Sequential behavior is achieved by model turns queuing later asynchronous calls.
- The default tool timeout is `shellTimeoutMs` from settings unless a tool manifest declares `timeoutMs`.
- Turn cancellation is propagated to worker processes and to the immediate external manifest command process.
- External tools that spawn their own children must handle cleanup for that deeper process tree.

## Model Providers

- Real model execution uses the active model's provider from `settings.json`.
- OpenAI-compatible execution uses Responses first. `404` and `405` from `/responses` permanently switch that client instance to Chat Completions fallback.
- OpenAI-compatible Responses execution must not send `previous_response_id`; server-side conversation continuation is intentionally unused.
- Every model request must include the local client-side conversation stack needed for that request, including prior user turns, assistant text, tool calls, and tool outputs.
- Anthropic execution uses Messages and converts OpenAI-style function schemas to Anthropic tool schemas.
- The agent loop only sees normalized function tool calls and `function_call_output` items. Provider-specific content blocks do not leak into `src/agent`.
- Native Responses-only `namespace`, freeform, local_shell, and image_generation tool types are represented as function-compatible TypeScript contracts.
- Multi-agent and agent-job task tools return unavailable until corresponding TypeScript task backends exist.

## Process Library

- `src/process/` must not import ndx config, session, tool, model, or runtime modules.
- `TaskQueue` instances are independent. There is no global queue singleton.
- Queue plans may nest `{ "serial": [...] }` and `{ "parallel": [...] }` nodes.
- Cancellation is delivered through `AbortSignal` plus per-task cancellation hooks.
- `runProcess` must honor an already-aborted signal as well as a signal aborted after spawn.

## MCP And Plugins

- Project MCP settings have higher priority than global MCP settings.
- MCP command servers are queried with `tools/list` at startup. Static `tools[]` entries remain supported for servers that cannot be queried during tests or offline runs.
- Plugin tools are discovered from filesystem plugin layer directories, not from `settings.json` plugin entries.

## Browser Markup

The only rendered frontend view is the agent-service dashboard placeholder at
`GET /` and `GET /dashboard` on the dashboard listener.

- The page exposes one `main` landmark named by the visible `ndx Agent Service`
  heading.
- The status text uses `role="status"`.
- The stable machine-only locator is
  `data-testid="agent-dashboard-placeholder"`.

No other UI selectors are part of the contract yet.
