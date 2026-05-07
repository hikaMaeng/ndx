# Internals

The package is the domain boundary for ndx. `SessionServer` wires model clients,
Docker sandbox state, SQLite persistence, dashboard HTTP, and `AgentRuntime`.
`AgentRuntime` emits protocol events and calls an injected agent runner.
`runAgent` owns max-turn enforcement and delegates the rest of the loop to
focused submodules. The entrypoint creates the turn state and tool registry,
then repeats sampling until the model either returns final text or the
configured turn budget is exhausted.

## Agent Loop Parity

OpenAI Codex Rust uses a layered loop:

| Codex Rust responsibility | Rust location | NDX owner |
| ------------------------- | ------------- | --------- |
| Session task envelope and repeated pending-input turns | `core/src/tasks/regular.rs` | `src/runtime/` and `src/session/` own turn lifecycle; `runAgent` owns only model/tool follow-up. |
| Turn preparation, skills/plugins/apps/context injection | `core/src/session/turn.rs` | `src/agent/loop/skills.ts` injects selected skills; project docs, MCP, plugins, and persisted history are prepared by config/session/runtime. |
| Prompt history normalization and token accounting | `core/src/context_manager/history.rs` | `src/runtime/history.ts` and provider adapters preserve call/output ordering; no loop-local compaction yet. |
| Sampling, retry, final-message detection | `core/src/session/turn.rs` | `src/agent/loop/sampling.ts` sends one provider request, records response items, and decides follow-up on tool calls. |
| Parallel tool dispatch, cancellation, abort output | `core/src/tools/parallel.rs` | `src/agent/loop/tool-execution.ts` runs tool calls concurrently through child workers and honors `AbortSignal`. |
| Approval, sandbox selection, retry escalation | `core/src/tools/orchestrator.rs` | NDX keeps approval/sandbox policy in tool worker, Docker sandbox, and process layers; the loop does not bypass those boundaries. |
| Streamed reasoning, hooks, auto-compaction, pending input | `core/src/session/turn.rs` plus hook/compact modules | Deferred in this package loop unless supplied by provider/runtime layers. |

The structure is homomorphic at the core sampling cycle:
model input -> response recording -> tool dispatch -> tool outputs -> next
model input. It is intentionally not a direct port of Codex Rust session
machinery because NDX keeps server lifecycle, Docker sandboxing, collaboration
tools, and persistent runtime events in separate TypeScript modules.

Tool workers execute as child Node processes. External tools and MCP stdio
commands use Docker when the server provides `NDX_SANDBOX_CONTAINER`.
