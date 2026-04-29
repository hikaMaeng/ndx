# Test Plan: session-server

## Created

2026-04-29

## Goal

Verify that the TypeScript session server is the live session owner for thread
state, WebSocket delivery, and JSONL persistence.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through `npm test`

## Preconditions

- Dependencies are installed.
- No external model provider is required; tests use `MockModelClient`.
- Temporary config and tool directories are created under the OS temp directory.

## Steps

1. Run `npm test`.
2. Start `SessionServer` on loopback port `0`.
3. Connect two WebSocket clients.
4. Send `initialize`, `thread/start`, `thread/subscribe`, and `turn/start`.
5. Wait for `turn/completed` on the subscriber client.
6. Read server-side thread state through `thread/read`.
7. Read the server-owned JSONL file from the configured persistence directory.

## Expected Results

- The owner client receives thread, session, turn, tool, message, and completion notifications.
- The subscriber client receives the same turn completion.
- `thread/read` returns the live thread and runtime events.
- JSONL contains `thread_started`, `runtime_event`, and `notification` records.

## Logs To Capture

- `npm test` pass/fail output.
- JSONL record type assertions from the integration test.

## Locator Contract

No browser UI exists for this package.
