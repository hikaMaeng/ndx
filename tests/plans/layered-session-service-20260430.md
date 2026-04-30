# Test Plan: layered-session-service

## Created

2026-04-30

## Goal

Verify the three-layer session architecture changes: configurable session
origin, user/year/month/session JSONL layout, account and client identity
socket methods, CLI client identity propagation, and dashboard placeholder.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js and Docker Compose from local shell
- Branch: `codex/layeredarchitecture`

## Preconditions

- Dependencies installed.
- `/home/.ndx/settings.json` or project `.ndx/settings.json` exists for deploy
  verification.
- Docker daemon available for `npm run deploy`.

## Steps

1. Run `npm test`.
2. Confirm config tests cover optional `sessionPath`.
3. Confirm session-server tests cover default user hierarchy,
   account create/login/password change, client id tracking, restore, delete,
   owner contention, and dashboard placeholder HTTP response.
4. Run `npm run deploy`.
5. Browser-verify the deployed dashboard placeholder at `/` or `/dashboard`.

## Expected Results

- All Node tests pass.
- Session JSONL files are created under
  `<sessionOrigin>/<user>/<yyyy>/<mm>/<sessionUuid>.jsonl`.
- CLI requests include `user` and `clientId`.
- Dashboard placeholder exposes semantic locator contract.
- Deploy rebuilds the compose target and runs in-container tests and mock agent.

## Logs To Capture

- `npm test` TAP summary.
- `npm run deploy` build/test/mock-agent summary.
- Browser verification URL, locator strategy, and observed status text.

## Locator Contract

- `main` landmark named by `ndx Agent Service`.
- `role="status"` text `Dashboard placeholder is running.`
- `data-testid="agent-dashboard-placeholder"`.
