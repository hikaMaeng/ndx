# codex-core API

Stable internal entrypoints for the agent loop:

- `Codex::submit` / `Codex::submit_with_trace`: enqueue an `Op`.
- `Codex::next_event`: read emitted protocol events.
- `Session::spawn_task`: replace active work and start a `SessionTask`.
- `Session::start_task`: create cancellation token, active turn state, and Tokio task.
- `Session::steer_input`: append user input to the current regular turn.
- `Session::get_pending_input`: drain turn-local pending input plus accepted mailbox mail.
- `run_turn`: execute one logical turn across model sampling requests.
- `run_sampling_request`: build tools, prompt, and retry a model stream.
- `try_run_sampling_request`: consume one model response stream.
- `handle_output_item_done`: persist response items and queue tool execution futures.

The model-facing tool API is built from `ToolSpec` values. The Rust runtime does not infer arbitrary operations from free text; it only dispatches structured `ResponseItem` variants that the model stream emits.

