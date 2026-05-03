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

## Tools

`ToolRegistry` scans task, core, project, global, plugin, and MCP layers. Each
tool call runs in a worker Node process. Task tools execute in the worker.
External tools and configured MCP commands execute in the Docker sandbox when
the server provides `NDX_SANDBOX_CONTAINER`.

Host paths are mapped into sandbox paths before `docker exec`; project paths map
under `/workspace` and global paths map under `/home/.ndx`.
