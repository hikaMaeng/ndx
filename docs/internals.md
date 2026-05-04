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
info, JSON-RPC helpers, params, notifications, social auth verification,
runtime-event predicates, and WebSocket connection state.

SQLite stores accounts, social links, sessions, request records, runtime events,
context replay rows, notifications, and ownership rows. Empty sessions remain
unnumbered and unpersisted until the first prompt.

Lite context mode keeps persisted tool call and tool result rows for audit, but
omits prior tool rows from model context when a new user turn starts. The active
turn keeps its local tool stack until the model finishes or exhausts the turn
limit.

## Managed CLI Server

`runManagedWorkspace` probes the requested WebSocket URL. On a miss it repairs
or creates settings in the foreground, spawns `ndxserver` in detached server
mode with the current cwd and managed ports, polls readiness with staged
connection probes, and then uses `SessionClient` like any other client. Probe
logs distinguish connect, login, initialize, and server-name failures. The
managed server is not owned by the CLI object graph and is not closed by CLI
cleanup.

Managed startup chooses the background launcher by OS instead of relying on a
single `spawn` contract. Windows launches a hidden PowerShell host that runs the
current Node entrypoint directly. The launcher only appends lifecycle
diagnostics to `~/.ndx/system/logs/managed-server.log` when that path is
writable, falling back to the user temp directory as
`ndx-managed-server.log`; diagnostic write failures and server stdout/stderr
logging do not gate server execution. When a writable diagnostic path is
selected, Windows server stdout/stderr is appended there and CLI timeout output
prints the diagnostic tail. The parent CLI also redirects the hidden
PowerShell host stdout/stderr to `ndx-managed-server-host.log` when it can open
that temp file. macOS launches the current Node entrypoint through `nohup` as a
user background process. Linux launches through `setsid` when available,
falling back to `nohup`. Unknown platforms use direct detached Node spawn.

## Tools

`ToolRegistry` scans task, core, project, global, plugin, and MCP layers. Each
tool call runs in a worker Node process. Task tools execute in the worker.
External tools and configured MCP commands execute in the Docker sandbox when
the server provides `NDX_SANDBOX_CONTAINER`.

Host paths are mapped into sandbox paths before `docker exec`; project paths map
under `/workspace` and global paths map under `/home/.ndx`.
