# Internals

## Settings Loader

`loadConfig` reads global settings first and project settings second. Scalar
fields use last-writer-wins. Providers, permissions, websearch, MCP, keys, env,
and tools merge by key. Model catalogs may be arrays or object maps and merge by
local model id.

`ensureGlobalNdxHome` creates the global directory, `system/tools`,
`system/skills`, and built-in core tool packages. Built-in package manifests and
runtimes are generated from `src/config/core-tools.ts`.

## Defaults

`src/config/defaults.ts` owns runtime constants shared across CLI, server,
sandbox, MCP, and external tool execution. Package version discovery lives in
`src/config/package-version.ts`.

## Agent Loop

`runAgent` owns the model/tool loop. It sends the local conversation stack to
the model client, executes returned tool calls, appends
`function_call_output` items, and stops when the model returns text without tool
calls. The loop is bounded by `config.maxTurns`.

`AgentRuntime` wraps the loop with session ids, turn ids, abort handling,
runtime events, history, and provider error classification.

## Session Server

`SessionServer` owns live sessions, WebSocket clients, auth, SQLite persistence,
Docker sandbox preparation, and dashboard HTTP. Helper modules under
`src/session/server/` own dashboard rendering, bootstrap formatting, server
info, JSON-RPC helpers, params, notifications, runtime-event predicates, and
WebSocket connection state.

SQLite `users` is the local account authority. The canonical account fields are
`userid`, `created`, `lastlogin`, `isblock`, and `isprotected`; legacy `id` and
`username` remain as compatibility keys for foreign keys. User ids are
lowercased ASCII letters and digits. Accounts have no passwords, cannot be
deleted, and the protected `defaultuser` row is bootstrapped with matching
`created` and `lastlogin` timestamps. `account/previous` reads the non-blocked
row with the greatest `lastlogin`, so CLI startup does not depend on host client
state.

Session-domain data is reset to the clean `session` and `sessiondata` schema;
the former `projects`, `sessions`, `session_events`, `session_context_*`, and
`session_owners` tables are dropped by the schema reset path. Empty sessions
remain unnumbered and unpersisted until the first prompt.

The `session` table is the metadata projection used to inspect session identity
and ownership:

| Column | Contract |
| ------ | -------- |
| `rowid` | Monotonic SQLite primary key. |
| `sessionid` | Runtime session UUID. |
| `created` | Session metadata creation timestamp. |
| `userid` | Account id that can see the session. |
| `projectid` | UUID from `<project>/.ndx/.project`. |
| `path` | Physical project path for display and sandbox preparation. |
| `islite` | Persisted lite context mode flag. |
| `ownerid` | Current client ownership UUID allowed to update the session. |
| `lastlogin` | Last ownership claim timestamp. |

The `sessiondata` table stores persisted session payload records with `type`,
`sessionrowid`, `ownerid`, `created`, and `payload_json`; it also stores
runtime replay metadata (`msgtype`, `turnid`, `iscontext`) as implementation
columns. Runtime replay, dashboard event pages, compact summaries, and lite
pruning all read from `sessiondata`.

Lite context mode keeps persisted tool call and tool result rows for audit, but
omits prior tool rows from model context when a new user turn starts. The active
turn keeps its local tool stack until the model finishes or exhausts the turn
limit. Toggling lite mode updates `session.islite`.

## Managed CLI Server

`runManagedWorkspace` probes the requested WebSocket URL. On a miss it repairs
or creates settings in the foreground, spawns `ndxserver` in detached server
mode with the current cwd and managed ports, polls readiness with staged
connection probes, and then uses `SessionClient` like any other client. Probe
logs distinguish connect, login, initialize, and server-name failures. The
managed server is not owned by the CLI object graph and is not closed by CLI
cleanup.

Managed startup chooses the background launcher by OS instead of relying on a
single `spawn` contract. Windows launches the current Node entrypoint directly
as a hidden detached process and redirects stdout/stderr to
`ndx-managed-server-host.log` when it can open that temp file. All managed
launchers set `NDX_MANAGED_SERVER=1`; server mode treats that as a background
lifetime contract and ignores `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGBREAK`,
leaving dashboard exit as the normal shutdown path. `ndxserver stop` calls the
dashboard `/api/exit` endpoint and waits until the WebSocket endpoint is no
longer reachable. Plain
`ndxserver` on Windows is a background server trigger; `ndxserver serve` keeps
the foreground server mode for explicit diagnostics and for the managed launcher
body. The package maps `ndxserver` to a dedicated bootstrap entrypoint that sets
`NDX_INVOKED_AS_SERVER=1` before loading the shared CLI main module. macOS
launches the current Node entrypoint through `nohup` as a user background
process. Linux launches through `setsid` when available, falling back to
`nohup`. Unknown platforms use direct detached Node spawn.

## Tools

`ToolRegistry` scans task, core, project, global, plugin, and MCP layers. Each
tool call runs in a worker Node process. Task tools execute in the worker.
External tools and configured MCP commands execute in the Docker sandbox when
the server provides `NDX_SANDBOX_CONTAINER`.

Host paths are mapped into sandbox paths before `docker exec`; project paths map
under `/workspace` and global paths map under `/home/.ndx`.
