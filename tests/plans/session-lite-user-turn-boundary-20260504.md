# Test Plan: session lite user turn boundary

## Created

2026-05-04

## Goal

Verify lite context mode prunes prior tool call and tool result context only when
a new user turn starts, while preserving persisted logs and the active turn tool
stack.

## Environment

- Local Node test runner
- Temporary SQLite persistence directory
- Mock shell tool under temporary global `.ndx`

## Preconditions

- Session server can persist runtime events to SQLite.
- Lite mode can be toggled with `/lite on`.

## Steps

1. Start a persisted session and run a model turn that calls the shell tool.
2. Enable lite mode and inspect current context before the next prompt.
3. Start a second user turn and capture the model input.
4. Run a separate session where the first turn hits `maxTurns` after a tool
   call, then enable lite and start a second user turn.
5. Inspect SQLite context rows after each run.

## Expected Results

- Current context after `/lite on` still contains the latest turn tool rows.
- The next user turn model input excludes prior `assistant_tool_calls` and
  `function_call_output` items.
- Failed prior turns are pruned by the next user request boundary.
- SQLite context storage still contains the original tool call and tool result
  events for audit.

## Logs To Capture

- Targeted `node --test` output for `tests/session-server.test.ts`
- Any assertion failures or timeout output

## Locator Contract

Not applicable; this is session runtime behavior with no browser surface.
