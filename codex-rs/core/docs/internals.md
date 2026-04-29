# codex-core internals

`docs/agent-loop.md` is the detailed internal reference for the agent loop.

Key internal state:

- `ActiveTurn`: map of running task id to `RunningTask`, plus shared `TurnState`.
- `RunningTask`: task kind, abort-on-drop handle, cancellation token, `TurnContext`, completion `Notify`.
- `TurnState`: pending approvals, request-permissions waits, user-input waits, MCP elicitations, dynamic-tool waits, pending model input, mailbox delivery phase, granted permissions, tool-call count, token baseline.
- `ContextManager`: normalized model history, history version, token info, reference context baseline.
- `Mailbox`: unbounded inter-agent channel plus monotonic watch sequence.
- `AgentControl`: scoped subagent registry and spawn/message/resume/close control plane.

Loop termination is event driven, not timeout driven. A turn stops only when the model stream completes without follow-up work, a hook stops/aborts completion, cancellation fires, an unrecoverable error occurs, or shutdown/interrupt replaces the active task.

