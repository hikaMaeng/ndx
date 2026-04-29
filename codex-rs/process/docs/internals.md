# Internals

## Process Runtime

`ProcessManager` stores active processes in a mutex-protected map keyed by
`ProcessId`. Each process owns a oneshot cancellation sender. The child task
streams stdout and stderr concurrently, waits for exit, emits terminal events,
and removes itself from the registry.

## Queue Runtime

`TaskQueue` stores registered `QueueTask` implementations by `TaskId`.
`Serial` plans execute child nodes in order. `Parallel` plans spawn child plan
execution on Tokio tasks and join all results.

The recursive plan runner is boxed so nested plan depth is represented on the
heap instead of requiring an infinitely sized async future.
