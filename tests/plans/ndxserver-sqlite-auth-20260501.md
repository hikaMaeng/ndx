# Test Plan: ndxserver-sqlite-auth

## Created

2026-05-01

## Goal

Verify ndx server split socket/dashboard listeners, SQLite account/session persistence, socket authentication, CLI login, restore/delete ownership behavior, and dashboard locator contract.

## Environment

- Host: local TypeScript workspace.
- Runtime: Node.js with built-in `node:sqlite`.
- Commands: `npm run build`, targeted Node test runner, full `npm test`, `npm run deploy`.

## Preconditions

- Dependencies installed.
- Docker available for deploy verification.
- Branch pushed before compose deploy because `npm run deploy` builds from `NDX_GIT_REF`.

## Steps

1. Build TypeScript with `npm run build`.
2. Run targeted session and CLI tests:
   `node --test dist/tests/session-server.test.js dist/tests/cli-session-client.test.js`.
3. Run full package test suite with `npm test`.
4. Push the feature branch and run `npm run deploy`.
5. Browser-verify the dashboard placeholder on the deployed server if the deploy stack leaves a reachable dashboard URL.

## Expected Results

- Socket methods reject unauthenticated non-public requests.
- CLI sends `initialize` then `account/login` before session work.
- Account and session rows persist in `<dataDir>/ndx.sqlite`.
- Session restore rebuilds model context from SQLite runtime events.
- Delete marks non-current sessions deleted and stale owners receive `session/deleted`.
- Dashboard exposes the documented locator contract.

## Logs To Capture

- Build and test command exit codes.
- Node test summary.
- Deploy output including Docker build/test/mock-agent phases.
- Dashboard URL and browser locator result when available.

## Locator Contract

- `main` landmark named by `ndx Agent Service`.
- `role="status"` on dashboard status text.
- `data-testid="agent-dashboard-placeholder"`.
