# Test Plan: cli-auth-workspace-bootstrap

## Created

2026-05-01

## Goal

Verify host CLI last-login state, social/default login boundaries, and automatic workspace Docker bootstrap metadata.

## Environment

- Workspace: `/mnt/c/Users/hika0/.codex/worktrees/5fa7/ndx`
- Node 22 with Yarn 4 Plug'n'Play
- Docker available for deploy verification

## Preconditions

- Repository dependencies installed with `yarn install --immutable`.
- No real Google or GitHub OAuth token is required for automated tests; server social profile fetch is mocked.

## Steps

1. Run `yarn build`.
2. Run `yarn test`.
3. Verify CLI `/login` stores `defaultUser` as the shared last-login value.
4. Verify workspace bootstrap writes compose metadata and project settings while keeping CLI login state under `NDX_CLI_STATE_DIR`.
5. Verify `account/socialLogin` creates a `provider:subject` user from a verified profile response.
6. Run `npm run deploy` after committing/pushing if Docker remote-clone verification is required.

## Expected Results

- Build succeeds.
- All local tests pass.
- The session server treats the authenticated WebSocket user as authoritative.
- Workspace bootstrap compose files point the current folder at `/workspace`.

## Logs To Capture

- `yarn build`
- `yarn test`
- `npm run deploy` output when run

## Locator Contract

No new browser UI. Existing dashboard placeholder locator contract remains:
`main` named `ndx Agent Service`, `role="status"`, and
`data-testid="agent-dashboard-placeholder"`.
