# Architecture

## Workspace Layout

| Folder                 | Role                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `apps/ndx/`            | Publish-facing `@neurondev/ndx` bin wrappers for `ndx`/`ndxserver`. |
| `apps/ndxserver/`      | Private server wrapper used as a separate app boundary.           |
| `apps/toolcontainer/`  | Docker build context for the workspace tool sandbox.              |
| `packages/ndx/`        | `@neurondev/ndx-core` domain package.                             |
| `packages/ndx/src/cli/` | CLI entrypoint, managed startup, login helpers, session client.   |
| `packages/ndx/src/server/` | Public server export surface.                                  |
| `packages/ndx/src/dashboard/` | Public dashboard export surface.                            |
| `packages/ndx/src/config/` | Defaults, settings loading, bootstrap, version lookup.        |
| `packages/ndx/src/model/` | Provider adapters, mock client, routed model factory.          |
| `packages/ndx/src/tools/` | Tool registry, worker execution, external tools, MCP adapters. |
| `packages/ndx/src/session/` | WebSocket server/client, SQLite store, Docker sandbox.       |
| `packages/ndx/src/shared/` | Protocol and shared runtime data contracts.                   |

Apps depend on packages. Packages do not depend on apps. Inside
`packages/ndx`, dependencies are kept one-way: shared/config/model/process/tools
feed agent/runtime/session/cli rather than importing app wrappers.

## Flow

1. `apps/ndx` bin wrappers import `@neurondev/ndx-core/cli` and call `main`.
2. `ndx` parses CLI flags and probes the requested WebSocket address.
2. Managed startup connects to an existing server or starts a detached
   `ndxserver` host process at `127.0.0.1:45123` plus dashboard
   `127.0.0.1:45124`, then connects over WebSocket.
3. The CLI calls public `server/info`, logs in, calls `initialize`, and starts
   or restores one session for the current folder.
4. The server loads global and project settings, bootstraps `/home/.ndx/system`,
   loads AGENTS.md and skill catalogs from the fixed project/user cascade, and
   prepares a Docker sandbox unless mock mode or
   `NDX_REQUIRE_DOCKER_SANDBOX=0` disables it.
5. `SessionServer` wires `runAgent` into `AgentRuntime`; runtime no longer
   imports the agent loop directly.
6. The tool registry exposes task, core, project, global, plugin, and MCP tools.
   Each tool call runs in a worker Node process.
7. External tools and MCP stdio commands run through `docker exec` when
   `NDX_SANDBOX_CONTAINER` is present.
8. Runtime events, context records, session metadata, session ownership, and
   local accounts persist in SQLite under the configured data directory.

## Session Identity

Sessions are scoped by account plus project id. The project id is not the
folder path. When a project folder first participates in a session, the server
creates `<cwd>/.ndx/.project` when missing and stores
`{"projectid":"<uuid>"}`. Removing that project identity file and reusing the
same physical path creates a different project scope.

SQLite keeps the durable metadata contract in `session`: `rowid`, `sessionid`,
`created`, `userid`, `projectid`, `path`, `islite`, `ownerid`, and
`lastlogin`, with runtime projection columns for status, title, sequence,
compact row, and dashboard ordering. Runtime payload rows are stored in
`sessiondata` and reference `session.rowid`. The old session-domain tables are
not part of the active schema.

## Process Lifetime

Managed `ndx` startup uses the same server body as `ndxserver serve`. The CLI
process only performs settings repair, detached server spawn, readiness polling,
login, and session interaction. CLI exit closes the client socket but does not
close the server process. The launcher is OS-specific: Windows uses plain
`ndxserver` as a background server trigger that directly detaches the current
Node entrypoint with hidden-window stdio capture and marks it with
`NDX_MANAGED_SERVER=1`, macOS uses `nohup`, Linux uses `setsid` with `nohup`
fallback, and unknown platforms use direct detached Node spawn. Managed servers
ignore terminal shutdown signals (`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`) so
client exit does not stop the background server; `ndxserver stop` is the normal
managed shutdown path. Foreground `ndxserver serve` still uses `SIGINT` or
`SIGTERM` as shutdown signals. Readiness polling reports the failed stage and
last error for connect, login, initialize, or server identity mismatch. On
timeout, the CLI prints launcher PID status and tails readable launcher logs.

## Change Boundaries

- Runtime defaults are owned by `packages/ndx/src/config/defaults.ts`.
- Settings schema, AGENTS.md discovery, skill discovery, and merge behavior are
  owned by `packages/ndx/src/config/index.ts`.
- Server JSON-RPC helpers, server info, social login verification, dashboard
  rendering, params, notifications, runtime-event predicates, and websocket
  connection state live under `packages/ndx/src/session/server/`.
- Tool execution subdomains live under `packages/ndx/src/tools/`.
