# Test Plan: verdaccio-managed-server-release-025

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.25` to Verdaccio after making managed server
processes ignore console `SIGINT` so client exit does not stop the background
server, and adding `ndxserver stop` as the explicit managed-server shutdown
command.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.25`.
- Verdaccio latest before publish is `0.1.24`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.25`.
8. Install `@neurondev/ndx@0.1.25` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Detached launch metadata includes `NDX_MANAGED_SERVER=1`.
- Managed server mode does not shut down on console `SIGINT`.
- Foreground `ndxserver serve` remains interruptible.
- `ndxserver stop` posts to dashboard `/api/exit` and waits for the WebSocket
  endpoint to stop.
- Verdaccio latest moves from `0.1.24` to `0.1.25`.
- Installed binaries print `0.1.25`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.
- On Windows, run `ndxserver`, connect with `ndx`, exit the client, and verify a
  later `ndx` attaches without spawning a new server.

## Locator Contract

Not applicable; this release has no browser surface.
