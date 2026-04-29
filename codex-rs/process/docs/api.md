# API

## Process Types

- `ProcessSpec`: command argv, cwd, env, stdin mode, and env clearing.
- `ProcessId`: caller-provided or generated process id.
- `ProcessEvent`: started, stdout, stderr, exited, cancelled.
- `ProcessOutput`: final stdout, stderr, and exit status.
- `ProcessManager`: instance-scoped process registry.
- `ProcessHandle`: per-process event subscription and final result handle.

## Queue Types

- `TaskId`: stable task identifier.
- `TaskPlan`: serial, parallel, or leaf task plan node.
- `TaskStatus`: pending, running, succeeded, failed, cancelled.
- `QueueTask`: async task trait with cancellation hook.
- `TaskContext`: task id plus cancellation token.
- `TaskQueue`: instance-scoped task registry and plan runner.
- `QueueEvent`: status changes and cancellation requests.

## Error Types

- `ProcessError`: process spawn, wait, duplicate, and unknown-process failures.
- `QueueError`: unknown task, task failure, and task cancellation.
