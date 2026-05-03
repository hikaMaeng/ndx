# Test Plan: managed-cli-detached-server

## Created

2026-05-04

## Goal

Verify normal `ndx` managed startup starts an independent `ndxserver` process
when the default WebSocket endpoint is unreachable, while preserving attach to
an already-running server.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Runtime: Node.js with Yarn PnP
- Shell: bash
- Docker available for deploy verification

## Preconditions

- Dependencies are installed with `yarn install --immutable`.
- No unrelated process is bound to the tested WebSocket port.
- The default dashboard port is not overridden unless explicitly testing
  `NDX_DASHBOARD_PORT`.

## Steps

1. Build TypeScript with `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. For manual runtime verification, start `ndx` against an unused socket
   address, exit the CLI, and confirm the server socket still accepts a later
   connection until the server is explicitly stopped.

## Expected Results

- Managed discovery returns reachable state for an existing session server.
- Managed fallback reports default dashboard port `45124` when
  `NDX_DASHBOARD_PORT` is unset.
- CLI managed fallback spawns server mode instead of embedding a
  `SessionServer` that closes during CLI cleanup.
- Deploy completes build, tests, compose cleanup, sandbox rebuild, sandbox
  write verification, and compose teardown.

## Logs To Capture

- `yarn build` output.
- `node --test dist/tests/cli-workspace.test.js` TAP output.
- `yarn test` TAP output.
- `npm run deploy` output.

## Locator Contract

Not applicable; this behavior has no browser surface.
