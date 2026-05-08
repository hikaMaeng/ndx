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

| Codex Rust responsibility                               | Rust location                                                                                                             | NDX owner                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session task envelope and repeated pending-input turns  | `core/src/tasks/regular.rs`                                                                                               | `src/runtime/` and `src/session/` own turn lifecycle; `runAgent` owns only model/tool follow-up.                                                                                                                   |
| Turn preparation, skills/plugins/apps/context injection | `core/src/session/turn.rs`, `core/src/session/mod.rs`, `core/src/context/environment_context.rs`, `core/src/agents_md.rs` | `src/agent/loop/initial-context.ts` injects AGENTS.md and environment context snapshots; `src/agent/loop/skills.ts` injects selected skills; MCP, plugins, and persisted history remain in config/session/runtime. |
| Explicit resource and artifact context                  | `core/src/protocol/user_input.rs`, `core/src/context/*`, `app-server-protocol/src/protocol/thread_history.rs`             | `src/agent/loop/artifacts.ts` adds only existing local file references from model-visible text; MCP resources require explicit resource tools.                                                                     |
| Prompt history normalization and token accounting       | `core/src/context_manager/history.rs`                                                                                     | `src/runtime/history.ts` and provider adapters preserve call/output ordering; no loop-local compaction yet.                                                                                                        |
| Sampling, streaming, final-message detection            | `core/src/session/turn.rs`                                                                                                | `src/agent/loop/sampling.ts` consumes provider stream events when available, emits item lifecycle/delta events, records response items, and decides follow-up on tool calls.                                       |
| Parallel tool dispatch, cancellation, abort output      | `core/src/tools/parallel.rs`                                                                                              | `src/agent/loop/tool-execution.ts` runs parallel-safe calls concurrently and executes non-parallel task tools in response order while honoring `AbortSignal`.                                                      |
| Sub-agent control plane                                 | `core/src/agent/control.rs`                                                                                               | `src/agent/subagents.ts` provides an in-process child-agent controller for collaboration tools; it does not yet implement Rust's full mailbox/watch graph.                                                         |
| Approval, sandbox selection, retry escalation           | `core/src/tools/orchestrator.rs`                                                                                          | NDX keeps approval/sandbox policy in tool worker, Docker sandbox, and process layers; the loop does not bypass those boundaries.                                                                                   |
| Reasoning deltas, hooks, auto-compaction, pending input | `core/src/session/turn.rs` plus hook/compact modules                                                                      | Reasoning delta rendering, hook continuations, and compaction remain deferred unless supplied by provider/runtime layers.                                                                                          |

The structure is homomorphic at the core sampling cycle:
model input -> response recording -> tool dispatch -> tool outputs -> next
model input. It is intentionally not a direct port of Codex Rust session
machinery because NDX keeps server lifecycle, Docker sandboxing, collaboration
tools, and persistent runtime events in separate TypeScript modules.

`runAgent` still returns the final assistant text for callers that need a
single answer. Progress is emitted through `AgentEvent`: item start,
assistant-text delta, function-call argument delta, item completion, tool
call/result, token count, warning, and final `model_text`. OpenAI Responses
streaming maps
`response.output_item.added`, `response.output_text.delta`,
`response.function_call_arguments.delta`, `response.output_item.done`, and
`response.completed` into that event contract.

Before the user prompt, NDX now builds an input-level context snapshot. The
snapshot deliberately reads AGENTS.md sources at turn construction time and
adds an `<environment_context>` message, so changes in project instructions,
working directory, shell, date, timezone, permission mode, and ndx runtime paths
are visible to the next sampling request without mutating persisted chat
history.

Tool workers execute as child Node processes. External tools and MCP stdio
commands use Docker when the server provides `NDX_SANDBOX_CONTAINER`.

Task tools execute through the in-process registry so they can access
turn-scoped context such as the shared sub-agent controller. External tool
runtimes still execute through their configured process boundary.

See `docs/agent-loop-analysis.md` for the code-grounded comparison of Rust
response streams, tool follow-up blocking, sub-agent control, artifact context,
and initial instruction assembly.
