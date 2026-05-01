# Test Plan: managed-workspace-socket-discovery

## Created

2026-05-01

## Goal

Verify managed workspace startup discovers an already-running ndx socket server
before invoking Docker.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Runtime: Node.js with Yarn PnP
- Shell: bash

## Preconditions

- Dependencies installed with `yarn install --immutable`.
- `NDX_CLI_STATE_DIR` is isolated per test.
- No Docker command is required for the socket-discovery test.

## Steps

1. Build TypeScript with `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run the full package test command with `yarn test`.
4. If Docker is available, run `npm run deploy`.

## Expected Results

- Workspace bootstrap still writes compose and project settings when no socket
  state is reachable and Docker management is disabled.
- Workspace bootstrap accepts a live ndx socket state for the current workspace
  even when the primary saved state is stale.
- The live socket path returns before any Docker compose command is spawned.

## Logs To Capture

- Node test TAP output for `cli-workspace.test.js`.
- Full `yarn test` output.
- `npm run deploy` output or a concrete reason it could not run.

## Locator Contract

Not applicable; this behavior has no browser surface.
