# codex-core constraints

Agent-loop constraints:

- A `Session` has at most one active turn.
- `spawn_task` aborts existing tasks before starting replacement work.
- Only `TaskKind::Regular` accepts steering through `steer_input`.
- Tool calls must be represented as structured response items before dispatch.
- Unsupported or malformed tool calls are converted into model-visible tool output unless they are fatal.
- Mutating tool handlers wait on `turn.tool_call_gate`.
- Tool execution respects cancellation via `CancellationToken`.
- Context compaction may replace history and advance model window generation.
- Contextual prompt fragments are recognized only through registered markers; no generic `<system-remainder>` parser exists in `codex-core`.

Do not add new loop lifecycle state that bypasses `ActiveTurn`, `TurnState`, or `SessionTask`.

