# Architecture

| Folder | Contract |
| ------ | -------- |
| `src/cli/` | CLI parsing, managed startup, auth helpers, session client. |
| `src/server/` | Public server export surface. |
| `src/dashboard/` | Public dashboard export surface. |
| `src/config/` | Defaults, settings, bootstrap, package version. |
| `src/model/` | Provider adapters and model routing without direct config loading. |
| `src/tools/` | Tool registry, worker execution, external tools, MCP adapters. |
| `src/agent/` | Model/tool loop public entrypoint and loop submodules. |
| `src/runtime/` | Runtime events, aborts, provider error classification. |
| `src/session/` | WebSocket server/client, SQLite store, Docker sandbox. |
| `src/process/` | Child process runner and task queue. |
| `src/shared/` | Protocol and shared data contracts. |

Dependency direction is app-to-core. Core must not import from `apps/*`.
`AgentRuntime` receives the agent runner by injection so runtime does not import
the agent loop directly.

## Agent Loop

`src/agent/loop.ts` remains the public `runAgent` entrypoint. The loop body is
split by responsibility:

| File | Contract |
| ---- | -------- |
| `src/agent/loop/types.ts` | Run options, event protocol, sampling result types. |
| `src/agent/loop/initial-context.ts` | Per-turn AGENTS.md and environment context snapshot. |
| `src/agent/loop/state.ts` | Conversation input state, history merge, model response recording. |
| `src/agent/loop/skills.ts` | Prompt-time skill mention resolution and skill content injection. |
| `src/agent/loop/sampling.ts` | One model sampling request, follow-up detection, tool-output continuation. |
| `src/agent/loop/tool-execution.ts` | Tool call event emission, argument parsing, worker execution, tool outputs. |

OpenAI Codex Rust separates the same high-level loop across session, task,
turn, context manager, and tool runtime modules. NDX mirrors that shape at the
package scale while keeping NDX-owned worker execution, MCP discovery, and
runtime event persistence outside the agent loop.
