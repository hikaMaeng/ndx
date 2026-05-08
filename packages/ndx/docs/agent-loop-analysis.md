# Agent Loop Analysis

This report records the code-grounded conclusions used for the
`codex/agent-loop-refactor` branch. It compares the historical OpenAI Codex
Rust runtime removed by commit `936da925` with the TypeScript NDX runtime in
this package.

## Evidence

Historical Rust sources inspected through `git show 936da925^:<path>`:

| Question | Rust evidence |
| -------- | ------------- |
| Regular task and repeated pending-input turns | `codex-rs/core/src/tasks/regular.rs` |
| Sampling loop, response stream handling, follow-up decision | `codex-rs/core/src/session/turn.rs` |
| AGENTS.md instruction assembly | `codex-rs/core/src/agents_md.rs` |
| `<environment_context>` user fragment | `codex-rs/core/src/context/environment_context.rs` |
| Sub-agent spawning, status, and parent notifications | `codex-rs/core/src/agent/control.rs` |

Current TypeScript sources:

| Question | NDX evidence |
| -------- | ------------ |
| Public agent loop and max-turn budget | `src/agent/loop.ts` |
| Per-turn AGENTS.md and environment context snapshot | `src/agent/loop/initial-context.ts` |
| Conversation state and final-message persistence | `src/agent/loop/state.ts` |
| Streaming collection and follow-up decision | `src/agent/loop/sampling.ts` |
| Tool execution and output accumulation | `src/agent/loop/tool-execution.ts` |
| Provider stream event mapping | `src/model/openai-responses.ts`, `src/model/openai.ts`, `src/model/router.ts` |
| Runtime and JSON-RPC progress events | `src/runtime/runtime.ts`, `src/shared/protocol.ts`, `src/session/server/notifications.ts` |
| Collaboration and agent-job tool availability | `src/tools/collaboration/agents.ts`, `src/tools/collaboration/agent-jobs.ts`, `src/tools/registry.ts` |

## Response Stream

Rust can receive multiple response items during one sampling request. Its turn
comment says one sampling request may return requested function calls or an
assistant message, and may contain multiple items. The session loop then records
completed response items and keeps sampling only when the result still needs
follow-up.

NDX now has the same separation between progress and final state:

- `ModelClient.stream` is optional and returns `ModelStreamEvent`.
- `OpenAiResponsesAdapter.stream` asks the Responses API for `stream: true`.
- `mapResponsesStreamEvent` maps `response.output_item.added`,
  `response.output_text.delta`, `response.function_call_arguments.delta`,
  `response.output_item.done`, and `response.completed`.
- `collectStreamingResponse` forwards `item_started`,
  `agent_message_delta`, `tool_call_delta`, and `item_completed` immediately,
  but only returns a `ModelResponse` after `response_completed`.
- `updateStateFromModelResponse` persists assistant text only when the final
  response is known; deltas are not stored as final history.

Conclusion: intermediate text and tool-call argument fragments can be emitted
inside a single model request, but branch state still advances on the completed
response item.

## Tool Follow-Up

Rust treats tool execution as a follow-up boundary. A sampling result can set
`model_needs_follow_up`; the outer loop combines that with pending input before
deciding whether to sample again. Tool outputs are written back into model
history before the next sampling request.

NDX has a narrower but explicit contract:

- `runSamplingRequest` gets one completed `ModelResponse`.
- `modelNeedsFollowUp` is true when `response.toolCalls.length > 0`.
- `executeToolCalls` runs every tool call with `Promise.all`.
- Only after all tool calls resolve does it emit `tool_result` events and return
  `function_call_output` items.
- `runSamplingRequest` pushes all returned output items into `state.input` and
  returns `needsFollowUp: true`.

Conclusion: NDX does not start the next model request after the first tool
result. It waits for the complete set of tool calls from that response to
finish, then sends the accumulated outputs together. Abort signals can interrupt
the wait; otherwise a hanging tool blocks that follow-up cycle.

## Sub-Agents And Agent Jobs

Rust has a real sub-agent control plane. `AgentControl::spawn_agent` reserves a
spawn slot, creates a child thread, submits the initial operation, and reports
status through live thread metadata, mailbox delivery, and watch receivers.
`format_environment_context_subagents` can render open child agents into the
parent environment context. Completion notifications are injected back into the
parent without necessarily triggering a new parent turn.

The current NDX TypeScript package exposes collaboration schemas but not the
backend:

- `collaborationTools()` registers `spawn_agent`, `send_input`,
  `resume_agent`, `wait_agent`, `close_agent`, and `list_agents`.
- `agentJobTools()` registers `spawn_agents_on_csv` and
  `report_agent_job_result`.
- Every implementation is a placeholder returning an `unavailable` JSON output.
- `supportsParallelToolCalls` is false for those task tool definitions.
- The agent loop still treats them as ordinary tool calls; their output is
  collected by `executeToolCalls` and fed back to the model like any other tool
  result.

Conclusion: in this branch, sub-agent and agent-job tools cannot create
background work in NDX. They also cannot keep the parent loop alive on their own.
They only affect the loop by returning an unavailable tool output that may cause
the model to choose another follow-up step.

## Queues And Concurrency

Rust uses multiple purpose-specific queues and wakeups: a submission queue for
ops, pending input on the active turn, mailbox delivery for inter-agent
messages, status watch receivers for agent state, cancellation tokens, and spawn
slot reservation for child-agent limits.

NDX currently keeps the model/tool loop simple:

- The public budget is `config.maxTurns` in `runAgent`.
- Tool calls from one model response run concurrently through `Promise.all`.
- Tool execution is delegated to child Node workers by `executeToolInWorker`.
- There is no loop-local semaphore in `src/agent/loop/*`.
- Collaboration and agent-job tools do not currently enqueue background work.

Conclusion: the active NDX loop has a max-turn guard and waits for all tool
calls before the next sample, but it does not have Rust's full task, mailbox,
status-watch, and child-agent queue topology.

## Initial Instructions

Rust separates base instructions from contextual user fragments. Base
instructions travel in the prompt envelope, while AGENTS.md, skills, apps,
permissions, and `<environment_context>` are inserted as model-visible
contextual messages.

NDX now mirrors that separation:

- Provider adapters receive `withOperationalInstructions(config.instructions)`
  as API-level instructions.
- `loadAgentsInstructions` in config discovery records AGENTS.md source paths in
  `config.contextSources`.
- `buildInitialContext` reads those `agents` sources at turn construction time.
- It renders one user message headed `# AGENTS.md instructions for <cwd>` with
  `<INSTRUCTIONS>...</INSTRUCTIONS>`.
- It then adds an `<environment_context>` user message containing cwd, shell,
  current date, timezone, permission mode, global ndx dir, and project ndx dir.
- `createInitialState` places this initial context before skill messages and the
  user's prompt.
- OpenAI Chat maps `developer` and `system` input messages back to chat
  `system`, while Responses accepts `system`, `developer`, `user`, and
  `assistant` message roles through `responsesInput`.

Conclusion: base instructions remain provider-level configuration, while
AGENTS.md and environment facts are per-turn user context. Updating AGENTS.md or
the execution environment affects the next newly constructed turn input without
mutating persisted assistant history.

## Branch Outcome

The branch implements streaming item lifecycle events and initial context
injection, but it intentionally does not port Rust's full session task graph,
sub-agent backend, hook continuations, or compaction machinery into the package
loop. Those remain separate future work unless session/runtime modules adopt the
larger Rust topology.
