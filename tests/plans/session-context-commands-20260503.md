# Test Plan: session-context-commands

## Created

2026-05-03

## Goal

Verify `/context`, `/compact`, and `/lite` report live context usage, persist
compacted context for restore replay, and do not regress session command,
dashboard, Docker sandbox, or deploy behavior.

## Environment

- OS/shell: Linux under the current bash workspace.
- Workspace: `/mnt/c/Users/hika0/.codex/worktrees/ea06/ndx`.
- Runtime: Node.js 22, Yarn 4.14.1, Docker compose.
- Browser: headless Chromium through locally available Playwright 1.59.1.

## Preconditions

- `yarn install --immutable` has installed the Plug'n'Play dependencies.
- Docker is available to build and run the pinned `hika00/ndx-sandbox:0.1.0`
  compose target.
- No required provider secrets are needed because mock mode covers server and
  browser verification.

## Steps

1. Run `yarn build`.
2. Run `yarn test`.
3. Run `npm run deploy`.
4. Start `node dist/src/cli/main.js serve --mock --cwd <workspace> --listen
127.0.0.1:45131 --dashboard-listen 127.0.0.1:45132`.
5. Fetch `http://127.0.0.1:45132/dashboard` and check dashboard semantic
   anchors.
6. Open the same URL with headless Chromium and verify role/name and test-id
   locators.
7. Stop the local server.

## Expected Results

- Build succeeds without TypeScript errors.
- All Node tests pass.
- Deploy builds, tests, removes old compose containers, rebuilds the sandbox
  image, starts the sandbox, verifies shell execution, and tears compose down.
- Dashboard exposes the documented locator contract.
- Context command tests cover context totals, kind breakdown, remaining tokens,
  compaction events, and restore replay.

## Logs To Capture

- Build/test/deploy command status.
- Docker compose build and container lifecycle status.
- Dashboard URL and locator verification output.

## Locator Contract

- `main` with `data-testid="ndx-dashboard"`.
- Heading named `Server Dashboard`.
- Navigation named `Server actions`.
- Buttons named `Reload` and `Exit`.
- `role="status"`.
- `data-testid="dashboard-sources"` and `dashboard-bootstrap`.
