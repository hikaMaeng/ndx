# Test Plan: session-list-restore

## Goal

Verify workspace-scoped session listing, first-prompt numbering, restore, and
ownership reclaim through the TypeScript session server and CLI command
controller.

## Environment

- OS shell: bash
- Runtime: Node.js 22+
- Package manager: npm scripts
- Server mode: embedded `SessionServer` in integration tests

## Preconditions

- Mock shell tool exists under the test global `.ndx/core/tools/shell`.
- Tests use a temporary global `.ndx` and temporary session persistence
  directory.

## Steps

1. Start a session server, initialize a client, start an empty session for a
   temporary workspace, and verify no JSONL file exists yet.
2. Run a mock turn and verify the session receives workspace number `1` and a
   prompt-derived title.
3. Flush JSONL persistence and verify `/session` lists `0. new session` plus
   session number `1`.
4. Execute `/restore 1` and verify the command returns a restore action with
   the same session id.
5. Stop the first server, start a second server with the same persistence
   directory, and call `session/list` for the same workspace.
6. Restore by number on the second server and verify persisted runtime events
   are returned.
7. Run another turn on the restored session and verify records continue
   appending to the original JSONL file.
8. Verify a second socket server can claim ownership and the first server
   reloads/reclaims on its next prompt attempt.
9. Verify the CLI controller updates its active session after a `/restore`
   command before sending the next `turn/start`.

## Expected Results

- Session sequence numbers are scoped to the requested resolved `cwd`.
- Empty sessions are not listed or persisted.
- Restored sessions reuse the original session id.
- `session_restored` is persisted.
- The restored session accepts subsequent turns.
- Last prompt attempt wins ownership after a persisted reload.
- CLI commands do not send `/session` or `/restore` text to the model prompt.

## Logs To Capture

- `npm run build`
- `npm test`
- Any deploy/browser verification status if performed
