# Test Plan: slash-command-session-server

## Created

2026-04-29

## Goal

Verify slash command metadata and implemented command execution are owned by the
TypeScript session server instead of CLI-only state.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js through repository `npm test`
- Server mode: embedded test `SessionServer`

## Preconditions

- `npm install` has already populated dependencies.
- The mock shell tool fixture can be created under a temporary global `.ndx`.

## Steps

1. Run `npm test`.
2. Confirm `command/list` includes Rust baseline commands and placement.
3. Confirm `command/execute` handles `/status` and `/events` from server thread
   state.
4. Confirm a registered but unimplemented core candidate returns a structured
   unsupported result.
5. Confirm the CLI controller routes slash input through `command/execute`.

## Expected Results

- TypeScript build succeeds.
- Node tests pass.
- `/compact` is present as a session built-in.
- `/diff` is present as a core candidate and is not sent to the model.

## Logs To Capture

- `npm test` command and pass/fail result.
- Any TypeScript compiler or node test failures.

## Locator Contract

Not applicable. This change has no browser UI.
