# Test Plan: cli-managed-workspace-project-selection

## Created

2026-05-02

## Goal

Verify the managed `ndx` startup contract: one server-address argument, Docker
fallback workspace mounting, post-login project selection, and `.ndx/system`
runtime storage.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22 with Yarn PnP

## Preconditions

- Dependencies are installed with `yarn install --immutable`.
- Docker is available for deploy verification; unit tests do not require Docker
  to start a real container.

## Steps

1. Build TypeScript with `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js dist/tests/config.test.js dist/tests/tools.test.js dist/tests/session-server.test.js dist/tests/cli-session-client.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy` after the branch containing the change is pushed.

## Expected Results

- `ndx` server address defaults to `ws://127.0.0.1:45123`.
- Docker fallback compose mounts the selected workspace folder at `/workspace`,
  mounts user `.ndx` at `/home/.ndx`, and mounts `/var/run/docker.sock`.
- The session server exposes `project/list` and `project/create`.
- Core tools are installed and discovered from `.ndx/system/core/tools`.
- SQLite defaults to `.ndx/system/ndx.sqlite`.

## Logs To Capture

- Targeted Node test TAP output.
- Full `yarn test` TAP output.
- Deploy output or reason deploy could not verify the local change.

## Locator Contract

Not applicable; this behavior has no browser surface.
