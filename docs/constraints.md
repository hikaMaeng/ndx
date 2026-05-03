# Constraints

## Config

- Global settings path is fixed at `/home/.ndx/settings.json`.
- The data directory is `/home/.ndx/system` unless settings define optional
  `dataPath`. Legacy `sessionPath` is accepted as a data-directory override.
- Account, project, session, event, and ownership records are stored in
  `<dataDir>/ndx.sqlite`; omitted user means `defaultUser`.
- Project settings path is `.ndx/settings.json` under the current project directory.
- Every settings file must contain a `"version"` string matching the installed
  ndx package version.
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
- The global `.ndx/system` directory is self-healing at startup for required directories and built-in `/system/tools` packages.
- `/home/.ndx/system` bootstrap information remains code-managed and is not stored in SQLite.
- The config loader does not invent model/provider settings, but it may update
  only `"version"` in otherwise valid settings files. TTY CLI startup handles
  missing or incomplete settings by asking setup questions, repairing global
  settings first, and then repairing the current project settings when present;
  non-TTY loading still fails before model selection.
- `AGENTS.md` files discovered from the current working directory ancestry are
  appended to runtime instructions after settings are merged. They are reported
  as initialization sources and are re-read by dashboard Reload.

## Host CLI State

- Host CLI app state is separate from `/home/.ndx` and project `.ndx`.
- `NDX_CLI_STATE_DIR` overrides the app-state directory.
- `auth.json` contains one shared last-login value for all host CLI instances.
- The host CLI does not manage Docker compose files for the server. Docker is a
  server-managed per-folder tool sandbox only.
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

- `ndx serve` and `ndxserver` expose two local-process ports: WebSocket JSON-RPC and HTTP dashboard.
- Docker compose must not be treated as the server owner. The root compose file
  owns only the `ndx-sandbox` service used for tool execution.
- The dashboard has no authentication or authorization.
- The dashboard Reload action is unauthenticated and re-runs global `.ndx`
  bootstrap plus settings and `AGENTS.md` source loading for new sessions.
- The dashboard Exit action is unauthenticated and requests shutdown of the
  local server instance that owns the dashboard listener.
- WebSocket methods other than `server/info`, `account/create`,
  `account/login`, and `account/socialLogin` require successful account login
  on that connection. Unauthenticated non-login requests are ignored.
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
- Every model tool call runs in a separate worker Node process. No capability
  tool executes inside the agent process.
- Multiple tool calls in one model response are launched in parallel. Sequential behavior is achieved by model turns queuing later asynchronous calls.
- The default tool timeout is `shellTimeoutMs` from settings unless a tool manifest declares `timeoutMs`.
- Turn cancellation is propagated to worker processes and to the immediate
  external manifest command process.
- External tools that spawn their own children must handle cleanup for that deeper process tree.
- When the server provides `NDX_SANDBOX_CONTAINER`, external manifest tools and
  configured MCP stdio commands run through `docker exec` in the workspace
  sandbox. Host paths from Windows or POSIX clients must be mapped to Linux
  container paths before they are used as `docker exec -w`; the active
  workspace maps to `/workspace` and global state maps to `/home/.ndx`. The
  default pinned image is `hika00/ndx-sandbox:0.1.0`.
- Core filesystem path tools map `/root` and `/root/...` to the active
  workspace cwd. This keeps model-selected container-home paths on the project
  bind mount rather than the sandbox home directory.
- Every sandboxed external tool execution must write JSONL audit records under
  `/home/.ndx/system/logs/tool-executions.jsonl` and mirror them to container
  stdout for `docker logs` inspection. Records include tool name, mapped cwd,
  process id when available, stdout, stderr, exit code, timeout, and
  cancellation status.
- Restored persisted sessions must rebind their runtime config to the current
  workspace sandbox before handling the next turn.
- Server-managed sandbox containers are named `ndx-tool-<folder-name>` and are
  created with the project folder mounted at `/workspace`, the user `.ndx`
  mounted at `/home/.ndx`, and `/var/run/docker.sock` mounted for Docker
  externalization.
- Server-managed sandbox containers carry `dev.ndx.owner=ndx-server`,
  `dev.ndx.role=tool-sandbox`, `dev.ndx.workspace=<host-path>`, and
  `dev.ndx.image=<image>` Docker labels.
- A server process with Docker sandboxing enabled removes all prior ndx
  server-owned sandbox containers at startup before creating its current
  workspace sandbox.
- The server must manage exactly one running tool sandbox per resolved physical
  project folder. It records the physical folder in Docker labels so a later
  server process can find the same container again. If two physical folders have
  the same basename, the preferred `ndx-tool-<folder-name>` is kept for the
  first folder and later colliding folders receive a deterministic hash suffix.
- The tool sandbox image must already contain the baseline tool-execution
  capabilities needed by core tools, including Bash, Git, Patch, Python, Node
  Corepack, and `/usr/local/bin/apply_patch`; server startup mounts state and
  projects but does not install those capabilities into the container.
- Sandbox Dockerfile changes require a new Docker Hub tag under `hika00`, a
  pushed image, and server verification against that exact tag before merge.

## Model Providers

- Real model execution uses the active model's provider from `settings.json`.
- Provider system instructions always include the operational rule that local
  file-changing requests must use tools in the active `cwd`; models must not
  answer with only code blocks unless explicitly asked for code text only. Tool
  failures must be retried with corrected arguments or reported clearly, not
  converted into manual copy/save instructions.
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

The rendered frontend view is the agent-service dashboard at `GET /` and
`GET /dashboard` on the dashboard listener.

- The page exposes one `main` landmark named by the visible `Server Dashboard`
  heading.
- The left menu is an `aside` named `Dashboard menu`; action controls are in
  `nav aria-label="Server actions"`.
- `Reload` and `Exit` are native buttons with stable accessible names.
- The action result text uses `role="status"` and may switch to `role="alert"`
  on failure.
- Stable machine-only locators are `data-testid="ndx-dashboard"`,
  `data-testid="dashboard-action-status"`, `data-testid="dashboard-sources"`,
  and `data-testid="dashboard-bootstrap"`.
- TUI and dashboard user-facing copy must remain English-only.

No other UI selectors are part of the contract yet.
