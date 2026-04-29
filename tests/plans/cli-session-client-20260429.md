# Test Plan: cli-session-client

## Created

2026-04-29

## Goal

Verify that the TypeScript CLI behaves as a session-server client: socket
initialization, thread startup, session initialization display, command
interface, and prompt execution are owned by the CLI controller without changing
the session server implementation.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through `npm test`

## Preconditions

- Dependencies are installed.
- Tests use a fake session transport for CLI controller behavior.
- Integration tests continue to use the existing mock session server.

## Steps

1. Run `npm test`.
2. Verify `CliSessionController.initialize()` sends `initialize` and renders server metadata.
3. Verify `CliSessionController.startThread()` sends `thread/start` and stores thread status.
4. Verify `/status`, `/init`, `/events`, `/interrupt`, and `/help` are handled as CLI-local commands.
5. Verify a prompt sends `turn/start`, records `thread/sessionConfigured`, and prints `turn/completed`.

## Expected Results

- CLI session controller requests happen in the expected order.
- Initialization detail is displayed and retained in CLI-local state.
- Runtime event types can be inspected through `/events`.
- Prompt output still prints only the final agent text on stdout.
- Existing session-server integration tests still pass.

## Logs To Capture

- `npm test` pass/fail output.
- Any TypeScript compile errors.
- Any failed assertion naming the affected CLI command or request.

## Locator Contract

No browser UI exists for this package.
