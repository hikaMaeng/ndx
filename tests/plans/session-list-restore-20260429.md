# Test Plan: session-list-restore

## Goal

Verify workspace-scoped session listing and restore through the TypeScript
session server and CLI command controller.

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

1. Start a session server, initialize a client, start a thread for a temporary
   workspace, and run a mock turn.
2. Flush JSONL persistence and verify `/session` lists the thread as number `1`.
3. Execute `/restore 1` and verify the command returns a restore action with
   the same thread id.
4. Stop the first server, start a second server with the same persistence
   directory, and call `thread/list` for the same workspace.
5. Restore by number on the second server and verify persisted runtime events
   are returned.
6. Run another turn on the restored thread and verify records continue appending
   to the original JSONL file.
7. Verify the CLI controller updates its active thread after a `/restore`
   command before sending the next `turn/start`.

## Expected Results

- Session list numbers are scoped to the requested resolved `cwd`.
- Restored sessions reuse the original session id.
- `thread_restored` is persisted.
- The restored thread accepts subsequent turns.
- CLI commands do not send `/session` or `/restore` text to the model prompt.

## Logs To Capture

- `npm run build`
- `npm test`
- Any deploy/browser verification status if performed
