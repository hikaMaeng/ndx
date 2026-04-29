# Architecture

## Package Boundary

`codex-process` has no dependencies on other `codex-*` crates. Callers adapt
their protocol IDs, tool session IDs, and output envelopes at the boundary.

## Process Manager

`ProcessManager` is an instance-scoped registry. Each manager owns only the
processes spawned through that manager. There is no global process manager.

Each spawned process returns a `ProcessHandle` with:

- stable `ProcessId`
- event subscription through a broadcast channel
- `wait()` for the final `ProcessOutput`

## Task Queue

`TaskQueue` is also instance-scoped. Multiple queues can run independently in
the same runtime.

`TaskPlan` supports:

- `Task(TaskId)`
- `Serial(Vec<TaskPlan>)`
- `Parallel(Vec<TaskPlan>)`

This permits nested plans such as serial groups containing parallel groups.

## Cancellation

Queue-wide cancellation uses a shared cancellation token. Individual task
cancellation invokes `QueueTask::on_cancel` for the selected task and marks that
task cancelled. Implementations use the hook to forward cancellation into owned
sessions, subprocesses, or tool-specific cleanup.
