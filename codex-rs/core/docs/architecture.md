# codex-core architecture

`Codex::spawn` creates a bounded submission channel, an event channel, `Session`, and a background `submission_loop`.

Runtime layers:

- `CodexThread`: public thread facade over `Codex`.
- `Codex`: queue pair API; submits `Submission` and receives `Event`.
- `Session`: mutable thread state, history, active turn, mailbox, services, persistence.
- `SessionTask`: background task abstraction for regular, compact, review, undo, and shell workflows.
- `TurnContext`: immutable per-turn runtime snapshot.
- `ContextManager`: model-visible history and token accounting.
- `ToolRouter` and `ToolRegistry`: model response item to internal tool handler dispatch.

The session owns at most one active turn. `Session::spawn_task` aborts existing tasks, clears connector selection, then starts a new task under `ActiveTurn`.

The regular agent path is:

1. `submission_loop` receives `Op::UserInput`, `Op::UserTurn`, or `Op::UserInputWithTurnContext`.
2. `user_input_or_turn_inner` builds a `TurnContext`.
3. If a regular turn is active, `Session::steer_input` appends pending input.
4. If no turn is active, `Session::spawn_task(..., RegularTask::new())` starts one.
5. `RegularTask::run` repeatedly calls `run_turn` until no pending input remains.
6. `run_turn` repeatedly samples the model until no model follow-up or pending input remains.

See `docs/agent-loop.md` for the detailed loop algorithm.

