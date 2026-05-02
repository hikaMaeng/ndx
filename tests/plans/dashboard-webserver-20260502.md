# Test Plan: dashboard-webserver

## Created

2026-05-02

## Goal

Verify the server dashboard shell, dashboard Reload and Exit HTTP actions, CLI dashboard URL output, and settings plus `AGENTS.md` reload behavior.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js 22 through Yarn Plug'n'Play
- Deploy target: `npm run deploy`

## Preconditions

- Repository dependencies are installed with `yarn install --immutable`.
- Docker and Docker Compose are available for `npm run deploy`.
- Local ports used by integration tests are ephemeral unless explicitly noted.

## Steps

1. Run `yarn build`.
2. Run focused Node tests for session server and CLI session client.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Start a mock server with explicit socket and dashboard ports.
6. Browser-verify `/dashboard` with Playwright locators.
7. POST dashboard Reload and verify the action status/source contract.
8. Stop the mock server.

## Expected Results

- Dashboard HTML exposes the left action menu, `Reload`, `Exit`, NDX version, server information, recognized sources, and bootstrap elements.
- `POST /api/reload` re-runs `.ndx` bootstrap and re-reads settings plus `AGENTS.md` for later sessions.
- `POST /api/exit` requests local server shutdown.
- CLI initialization output includes `[dashboard] <url>`.
- Deploy completes the local build, test, compose refresh, sandbox verification, and compose teardown.

## Logs To Capture

- Build and test command results.
- Deploy command result and Docker Compose output summary.
- Mock server stdout/stderr with `[session-server]` and `[dashboard]`.
- Browser verification locator results.

## Locator Contract

- `main` landmark named `Server Dashboard`.
- `aside` named `Dashboard menu`.
- Buttons named `Reload` and `Exit`.
- `role="status"` for dashboard action status.
- Stable test ids: `ndx-dashboard`, `dashboard-action-status`, `dashboard-sources`, `dashboard-bootstrap`.
