# Architecture

## Source Layout

| Folder         | Role                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `src/cli/`     | CLI entrypoint, managed startup, login helpers, interactive session client. |
| `src/config/`  | Defaults, settings loading, validation, merging, bootstrap, version lookup. |
| `src/model/`   | Provider adapters, mock client, routed model factory, sticky routing.       |
| `src/process/` | Process runner and serial/parallel task queue.                              |
| `src/agent/`   | Model/tool loop for one turn sequence.                                      |
| `src/runtime/` | Runtime event production, abort handling, provider error classification.    |
| `src/session/` | WebSocket server/client, SQLite store, Docker sandbox, commands, tools.     |
| `src/shared/`  | Protocol and shared runtime data contracts.                                 |

## Flow

1. `ndx` parses CLI flags and probes the requested WebSocket address.
2. Managed startup connects to an existing server or starts a detached
   `ndxserver` host process at `127.0.0.1:45123` plus dashboard
   `127.0.0.1:45124`, then connects over WebSocket.
3. The CLI calls public `server/info`, logs in, calls `initialize`, and starts
   or restores one session for the current folder.
4. The server loads global and project settings, bootstraps `/home/.ndx/system`,
   and prepares a Docker sandbox unless mock mode or
   `NDX_REQUIRE_DOCKER_SANDBOX=0` disables it.
5. `AgentRuntime` sends the local conversation stack to the model client and
   emits runtime events.
6. The tool registry exposes task, core, project, global, plugin, and MCP tools.
   Each tool call runs in a worker Node process.
7. External tools and MCP stdio commands run through `docker exec` when
   `NDX_SANDBOX_CONTAINER` is present.
8. Runtime events, context records, session ownership, accounts, and social
   links persist in SQLite under the configured data directory.

## Process Lifetime

Managed `ndx` startup uses the same server mode as `ndxserver`. The CLI process
only performs settings repair, detached server spawn, readiness polling, login,
and session interaction. CLI exit closes the client socket but does not close
the server process.

## Change Boundaries

- Runtime defaults are owned by `src/config/defaults.ts`.
- Settings schema and merge behavior are owned by `src/config/index.ts`.
- Server JSON-RPC helpers, server info, social login verification, dashboard
  rendering, params, notifications, runtime-event predicates, and websocket
  connection state live under `src/session/server/`.
- Tool execution subdomains live under `src/session/tools/`.
