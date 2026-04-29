# Test Plan: session-persistence-queue

## Created

2026-04-29

## Goal

Verify that session persistence uses a server-owned queue and child writer
process, and that disconnecting clients still causes live session state to be
persisted safely.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through `npm test`

## Preconditions

- Dependencies are installed.
- Tests use `MockModelClient`; no external model provider is required.
- Temporary session persistence directories are created under the OS temp directory.

## Steps

1. Run `npm test`.
2. Start `SessionServer` on loopback port `0`.
3. Connect owner and subscriber WebSocket clients.
4. Run a mock turn through `turn/start` and wait for `turn/completed`.
5. Flush server persistence and inspect JSONL records.
6. Close both clients without sending a session close request.
7. Wait for a `thread_detached` JSONL record.

## Expected Results

- Runtime and notification records are persisted.
- Every JSONL record includes `writerPid`, and it differs from the main test process PID.
- Client socket close produces a persisted `thread_detached` record.
- The server process does not throw when persistence is asynchronous.

## Logs To Capture

- `npm test` pass/fail output.
- JSONL record assertions for `writerPid` and `thread_detached`.

## Locator Contract

No browser UI exists for this package.
