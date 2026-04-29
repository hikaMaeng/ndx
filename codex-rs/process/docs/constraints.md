# Constraints

- Do not add dependencies on other `codex-*` crates.
- Keep protocol, JSON-RPC, UI, sandbox, and tool-specific session state outside
  this crate.
- Do not introduce a global singleton queue or process manager.
- Callers own mapping between external IDs and `ProcessId` or `TaskId`.
- Cancellation hooks must be idempotent because queue-wide and task-specific
  cancellation can race with normal task completion.
- Process output is retained in the final `ProcessOutput`; high-volume callers
  should consume streaming events and enforce their own retention policy.
