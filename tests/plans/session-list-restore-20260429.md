# Test Plan: session-list-restore

## Goal

Verify workspace-scoped session listing, first-prompt numbering, restore,
deletion, and ownership reclaim through the TypeScript session server and CLI
command controller.

## Environment

- OS shell: bash
- Runtime: Node.js 22+
- Package manager: npm scripts
- Server mode: embedded `SessionServer` in integration tests

## Preconditions

- Mock shell tool exists under the test global `.ndx/system/tools/shell`.
- Tests use a temporary global `.ndx` and temporary session persistence
  directory.

## Steps

1. Start a session server, initialize a client, start an empty session for a
   temporary workspace, and verify no JSONL file exists yet.
2. Run a mock turn and verify the session receives workspace number `1` and a
   prompt-derived title.
3. Flush JSONL persistence and verify `/session` lists `0. new session` plus
   session number `1`.
4. Execute `/restoreSession 1` and verify the command returns a restore action
   with the same session id.
5. Execute `/deleteSession`, verify the current session is omitted from the
   list, choose another listed number, and verify its JSONL and owner files are
   removed. Press Enter with no number in a separate run and verify deletion is
   cancelled.
6. Stop the first server, start a second server with the same persistence
   directory, and call `session/list` for the same workspace.
7. Restore by number on the second server and verify persisted runtime events
   are returned.
8. Run another turn on the restored session and verify records continue
   appending to the original JSONL file.
9. Verify a second socket server can claim ownership and the first server
   reloads/reclaims on its next prompt attempt.
10. Start a turn on the first socket server, hold model completion, restore the
    same session from a second socket server, then release the first server's
    model completion.
11. Verify the stale in-flight model text and `turn_complete` are not appended
    to JSONL and do not appear in `session/read`.
12. Delete a persisted session from one socket server, then verify another
    socket server holding that session emits `session/deleted`, closes clients,
    and terminates when a prompt starts or a held response completes.
13. Hold the owner file lock from a separate process, request restore from a
    second socket server, and verify restore waits for lock release before
    claiming the session.
14. Verify the CLI controller updates its active session after a
    `/restoreSession` command before sending the next `turn/start`.

## Expected Results

- Session sequence numbers are scoped to the requested resolved `cwd`.
- Empty sessions are not listed or persisted.
- Restored sessions reuse the original session id.
- `session_restored` is persisted.
- `/deleteSession` deletes only non-current workspace sessions and can be
  cancelled by empty input.
- Deleted held sessions emit `session/deleted` before sockets close.
- The restored session accepts subsequent turns.
- Last prompt attempt wins ownership after a persisted reload.
- Owner file claims are serialized; contention waits and retries before
  restore proceeds.
- In-flight output from a server that lost ownership is discarded from durable
  context.
- CLI commands do not send `/session`, `/restoreSession`, or `/deleteSession`
  text to the model prompt.

## Logs To Capture

- `npm run build`
- `npm test`
- Any deploy/browser verification status if performed
