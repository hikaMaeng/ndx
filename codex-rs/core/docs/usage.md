# codex-core usage

Use `CodexThread` or `Codex` as a queue pair:

- Submit `Op` values through `submit`.
- Read `Event` values through `next_event`.
- Use `Op::Interrupt` to cancel active work.
- Use `Op::Shutdown` to exit the background submission loop.

Regular user input can either start a new turn or steer an active regular turn. Review and compact tasks are not steerable.

Subagent communication is queued through mailbox messages. Mail marked `trigger_turn` can start an idle receiver turn through `maybe_start_turn_for_pending_work`.

Tool execution is model driven at the request level: the model emits function, custom, local-shell, tool-search, or MCP call items. Rust validates, normalizes, gates, and executes those calls through registered handlers.

