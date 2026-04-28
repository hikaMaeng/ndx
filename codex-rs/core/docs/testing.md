# codex-core testing

Relevant existing coverage:

- `src/session/tests.rs`: context update, history, compaction, steering, and session state behavior.
- `src/tasks/mod_tests.rs`: task lifecycle and cancellation behavior.
- `src/tools/handlers/multi_agents_tests.rs`: subagent spawn, wait, close, resume behavior.
- `tests/suite/*`: integration-level session, compaction, approvals, search, and app-server paths.

For agent-loop changes:

1. Run the changed crate test, normally `cargo test -p codex-core`.
2. If tool protocol shape changes, run protocol/app-server tests that cover the affected event or schema.
3. If context compaction or history reconstruction changes, add coverage around `ContextManager`, rollout reconstruction, and resume/fork.
4. If user-visible TUI output changes, update `codex-tui` snapshots.

