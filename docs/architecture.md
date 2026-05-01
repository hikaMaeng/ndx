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

1. CLI resolves `cwd` and reads existing `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and `/home/.ndx/search.json`. The config loader bootstraps missing required global `.ndx` directories and core tools. In TTY CLI runs with no settings, the CLI asks setup questions, writes project `.ndx/settings.json`, then reloads config.
2. Host CLI startup resolves CLI app state, probes saved workspace socket URLs,
   and attaches to the first reachable ndx WebSocket session server. In the
   standard container workspace `/workspace`, it also probes
   `ws://127.0.0.1:45123` before any Docker command. If no socket is reachable,
   it creates compose state for the current folder, starts the container, and
   then connects. `--mock` and `NDX_EMBEDDED_SERVER=1` keep the source-tree
   embedded loopback path.
3. Session server startup re-checks required global `.ndx` elements and installs any missing core directories, core tool package files, and skills directory before accepting session work.
4. The CLI is a session-server client. `CliSessionController` sends `initialize`, starts or restores one session, tracks socket/server/session status, receives notifications, and prints selected initialization, tool, warning, and final events.
5. The session server keeps sessions on the base config, chooses `MockModelClient` for `--mock`, otherwise creates a routed provider client, and creates one `AgentRuntime` per live session.
6. `AgentRuntime` emits `session_configured`, `turn_started`, tool, token, completion, warning, and error events into the server.
7. The session server stores accounts, social account links, sessions, request
   records, runtime events, notifications, and ownership in SQLite under the
   configured data directory.
8. The session server broadcasts notifications to subscribed WebSocket clients. CLI, TUI, VS Code, and other UIs are peers on this boundary.
9. `runAgent` sends the local client-side conversation stack to the model client through the runtime. It never relies on provider-side response continuation.
10. `ToolRegistry` is built once at startup by scanning task, core, project, global, plugin, and MCP layers.
11. Function schemas from that registry are sent to the model.
12. Every returned tool call is dispatched through the shared process runner to its own worker Node process.
13. Filesystem tools are executed from their `tool.json` command process. MCP tools are executed through the configured MCP stdio command. Task tools run inside the worker.
14. Tool outputs are sent back as `function_call_output` items until the model returns text without tool calls. Provider adapters translate those items to Responses, Chat Completions, or Anthropic Messages wire shapes.

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

The CLI does not persist live session state. Host CLI app state persists only
last-login and workspace server connection metadata; `/home/.ndx` and project
`.ndx` remain agent runtime configuration.

## SQLite Persistence

The session server opens `<dataDir>/ndx.sqlite` through `SqliteSessionStore`.
The default data directory is `/home/.ndx-data`; settings may define
`dataPath`, and legacy `sessionPath` is treated as a data-directory override.
`/home/.ndx` bootstrap state remains code-managed and is not stored in SQLite.

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

The socket server requires authentication for non-public JSON-RPC methods.
`initialize`, `account/create`, `account/login`, and `account/socialLogin` are
public; session, command, turn, account mutation, and delete methods require a
successful login. The CLI assigns a fresh client id per controller instance.
The server treats the authenticated connection user as authoritative and does
not rely on later request params to choose the user.

The service owns two listeners: a WebSocket socket port and a dashboard HTTP
port. `ndx serve` and `ndxserver` print both addresses. Normal HTTP requests to
`/` or `/dashboard` on the dashboard port return only a dashboard placeholder.
The placeholder exposes one `main` landmark named by `ndx Agent Service`, a
status message, and `data-testid="agent-dashboard-placeholder"` for browser
verification.

## Docker Flow

`npm run deploy` builds locally, removes previous compose containers, passes the current Git branch as `NDX_GIT_REF`, builds `ndx-agent` with `--no-cache` by cloning that remote branch into `/opt/ndx`, runs tests in the image from `/opt/ndx`, runs a mock agent from `/opt/ndx` that writes `/workspace/tmp/ndx-docker-verify.txt`, then tears compose down.

The default compose service runs `ndxserver`, not an idle sleep process. It
publishes the WebSocket JSON-RPC port and dashboard HTTP port separately, with
defaults `45123:45123` and `45124:45124`. Startup logs include `[ndx-image]`
provenance and `[ndx-service]` bind URL lines so Docker Desktop and compose
logs show both what image revision is running and which external URLs operators
should use. The default compose command uses `--mock` for service wiring
verification and never copies repository settings into `/home/.ndx`; real model
settings are created by the wizard or loaded through the normal global/project
settings cascade.
