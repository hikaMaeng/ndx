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
| `src/session/` | WebSocket session server/client, SQLite persistence, model tool execution.  |
| `src/shared/`  | Cross-module protocol and runtime data contracts.                           |

`src/session/tools/` is intentionally nested under `session`. It contains the
tool registry, worker process launcher, built-in task tools, external `tool.json`
adapter, and MCP adapter used by session turns. There is no top-level `src/tools`
domain.

The repository is a single root package. It does not carry legacy upstream SDK,
Bazel, devcontainer, release, or third-party trees. Runtime state belongs under
`docker/volume` during compose runs and is kept out of the tracked source tree
except for the two `.gitkeep` directory anchors.

## Runtime Flow

1. Host CLI startup probes the requested server address, defaulting to
   `127.0.0.1:45123`. `SERVER_ADDRESS` is the only normal `ndx` startup
   argument.
2. If no socket is reachable, the CLI reports the failed connection, resolves
   settings for the current folder, starts a local default `SessionServer` at the
   default address, and connects to that local process. `--mock` and
   `NDX_EMBEDDED_SERVER=1` remain source-tree development paths.
3. After WebSocket connect, the CLI logs in immediately. The server ignores
   unauthenticated non-login JSON-RPC methods.
4. After login and initialization, the server ensures a Docker tool sandbox for
   the current folder. If Docker cannot provide the pinned sandbox image or
   container, server startup fails and the CLI exits with that warning.
5. If no settings file exists, the interactive settings wizard writes global
   `/home/.ndx/settings.json`.
6. The current folder is the session `cwd`; the CLI does not ask for a
   workspace folder or project selection.
7. Session server startup re-checks required global `.ndx/system` elements and installs any missing system tool package files and skills directory before accepting session work.
8. The CLI is a session-server client. `CliSessionController` logs in, sends `initialize`, starts or restores one session, tracks socket/server/session status, receives notifications, and prints selected initialization, tool, warning, and final events.
9. The session server keeps sessions on the base config, chooses `MockModelClient` for `--mock`, otherwise creates a routed provider client, and creates one `AgentRuntime` per live session.
10. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events into the server.
11. The session server stores accounts, social account links, sessions, request
    records, runtime events, notifications, and ownership in SQLite under the
    configured data directory.
12. The session server broadcasts notifications to subscribed WebSocket clients. CLI, TUI, VS Code, and other UIs are peers on this boundary.
13. `runAgent` sends the local client-side conversation stack to the model client through the runtime. It never relies on provider-side response continuation.
14. `ToolRegistry` is built once at startup by scanning task, core, project, global, plugin, and MCP layers.
15. Function schemas from that registry are sent to the model.
16. Every returned tool call is dispatched through the shared process runner to its own worker Node process.
17. Shell-like core tools execute inside the current-folder Docker sandbox by using
    `docker exec` against the server-managed container. MCP tools are executed
    through the configured MCP stdio command. Task tools run inside the worker.
18. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls. Provider adapters translate those items to Responses, Chat Completions, or Anthropic Messages wire shapes.

## Model Routing And Context

The root config's first `model.session` entry is the display/default model.
`RoundRobinModelRouter` now uses round-robin only when first binding a selected
pool, then keeps the live session sticky to that model to preserve prefix-cache
locality. Normal prompts use `model.session`; a prompt containing `@customKey`
uses `model.custom.customKey`; tool follow-up requests keep the pool selected by
that prompt. Explicit `/model` model, effort, or thinking changes are treated as
new provider-client binding boundaries.

The context source is local. During a live session `AgentRuntime` owns the
in-memory history. For restore after process restart or ownership transfer, the
session events stored in SQLite are replayed into provider conversation items.
OpenAI Responses requests intentionally omit
`previous_response_id`, so inference servers do not need stable server-side
session state.

## Runtime Event Contract

The TypeScript runtime exposes the ndx protocol behind a WebSocket session server. `Submission` carries user turns and interrupts. `RuntimeEvent` carries session configuration, turn lifecycle, model text, tool call/result, token usage, abort, warning, and error messages.

The server translates runtime events into JSON-RPC notifications:

- `session/started`
- `session/configured`
- `turn/started`
- `item/toolCall`
- `item/toolResult`
- `item/agentMessage`
- `session/tokenUsage/updated`
- `turn/completed`
- `turn/aborted`
- `warning`
- `error`

Client programs must not maintain authoritative live session or persistence state. They may cache what they receive, but the server is the owner of live session state and durable SQLite records. Session initialization detail is displayed by the CLI and kept in client-local status/history only; it is not sent back as prompt context.

`initialize` responses and `session/configured` events include a bootstrap report. The report lists each required `.ndx` element, absolute path, and whether it already existed or was installed during startup.

## CLI Client Boundary

`src/cli/session-client.ts` owns CLI-only session behavior:

- robot plus uppercase `NDX` startup logo and socket initialization display
- last-login replay from host CLI app state
- `/login` menu for Google, GitHub, current account, and `defaultUser`
- session start status display
- `/status`, `/init`, `/events`, `/session`, `/restoreSession`,
  `/deleteSession`, and `/interrupt`
- runtime notification formatting for human output

The CLI does not persist live session state. After socket discovery and login it
follows the server protocol for initialization, session selection, and turn
execution. Host CLI app state persists only last-login metadata; `/home/.ndx`
and optional project `.ndx` remain agent runtime configuration.

## SQLite Persistence

The session server opens `<dataDir>/ndx.sqlite` through `SqliteSessionStore`.
The default data directory is `/home/.ndx/system`; settings may define
`dataPath`, and legacy `sessionPath` is treated as a data-directory override.
`/home/.ndx/system` bootstrap state remains code-managed and is not stored in SQLite.

SQLite tables own users, OAuth account links, projects, sessions, session
events, and session owners. `defaultUser` with an empty password is created on
first open so local CLI clients can authenticate without provisioning a
separate account.

When a WebSocket connection closes without an explicit session shutdown, the
server removes that connection from session subscriber sets. If a persisted
session has no remaining subscribers, the server records `session_detached`.
In-flight turns can still finish and record their final runtime events because
the live session remains in server memory.

If a request does not identify a user, the server uses `defaultUser`.

`session/list` and `/session` build a user-and-workspace-scoped view from live
memory plus SQLite records. The server filters by exact resolved
`cwd` and uses the persisted workspace sequence assigned on first prompt. Empty sessions
have title `empty`, no sequence number, and no durable row. `session/restore`
and `/restoreSession` accept either a listed number or the full session id,
create a new `AgentRuntime` with the original id when needed, load persisted
runtime events back into server memory, rebuild the provider-facing model
conversation history, and claim ownership. `/deleteSession` marks a
non-current listed session deleted and clears its owner row; any server still
holding that session detects the deleted SQLite row on the next prompt or turn
completion, emits `session/deleted`, closes its socket clients, and terminates.

The socket server requires authentication for non-login JSON-RPC methods.
`account/create`, `account/login`, and `account/socialLogin` are public;
session, command, turn, account mutation, delete, project, and `initialize`
methods require a successful login. Unauthenticated non-login requests are
ignored. The CLI assigns a fresh client id per controller instance.
The server treats the authenticated connection user as authoritative and does
not rely on later request params to choose the user.

The service owns two listeners: a WebSocket socket port and a dashboard HTTP
port. `ndx serve` and `ndxserver` print both addresses. Normal HTTP requests to
`/` or `/dashboard` on the dashboard port return only a dashboard placeholder.
The placeholder exposes one `main` landmark named by `ndx Agent Service`, a
status message, and `data-testid="agent-dashboard-placeholder"` for browser
verification.

## Docker Flow

`npm run deploy` builds and tests locally, removes previous compose containers,
builds `ndx-sandbox` with `--no-cache`, starts the sandbox with
`./docker/volume/workspace` mounted at `/workspace`, writes
`/workspace/tmp/ndx-docker-verify.txt` through `docker exec`, then tears compose
down.

The default compose service is `ndx-sandbox`. It runs `sleep infinity` and is
only a tool-execution sandbox. It does not run `ndxserver`, publish service
ports, or contain authoritative session state. Production server builds depend
on the pinned Docker Hub image `hika00/ndx-sandbox:0.1.0`; any sandbox
Dockerfile change must be pushed under a new Docker Hub tag and tested by the
server against that pushed tag.

The live server creates or reuses one Docker tool container per resolved
physical project folder. It finds existing containers through Docker labels,
uses `ndx-tool-<folder-name>` as the preferred name, and adds a deterministic
hash suffix only when two different physical folders share the same basename.
The image itself contains the baseline shell/tool runtime; startup only binds
the user `.ndx`, project folder, and Docker socket volumes.
