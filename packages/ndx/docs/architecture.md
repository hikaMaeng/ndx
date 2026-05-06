# Architecture

| Folder | Contract |
| ------ | -------- |
| `src/cli/` | CLI parsing, managed startup, auth helpers, session client. |
| `src/server/` | Public server export surface. |
| `src/dashboard/` | Public dashboard export surface. |
| `src/config/` | Defaults, settings, bootstrap, package version. |
| `src/model/` | Provider adapters and model routing without direct config loading. |
| `src/tools/` | Tool registry, worker execution, external tools, MCP adapters. |
| `src/agent/` | Model/tool loop. |
| `src/runtime/` | Runtime events, aborts, provider error classification. |
| `src/session/` | WebSocket server/client, SQLite store, Docker sandbox. |
| `src/process/` | Child process runner and task queue. |
| `src/shared/` | Protocol and shared data contracts. |

Dependency direction is app-to-core. Core must not import from `apps/*`.
`AgentRuntime` receives the agent runner by injection so runtime does not import
the agent loop directly.

