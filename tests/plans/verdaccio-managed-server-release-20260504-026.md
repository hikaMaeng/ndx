# Test Plan: verdaccio-managed-server-release-026

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.26` to Verdaccio after hardening managed server
lifetime so client exit cannot stop the background server through terminal
shutdown signals.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Target user environment: Windows PowerShell with globally installed package

## Preconditions

- Local package version is `0.1.26`.
- Verdaccio latest before publish is expected to be `0.1.25`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.26`.
8. Install `@neurondev/ndx@0.1.26` into an isolated prefix.
9. Verify installed `ndx --version`, `ndxserver --version`, and
   `ndxserver --help`.

## Expected Results

- Local build and tests pass.
- Managed server mode ignores `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGBREAK`.
- Foreground `ndxserver serve` remains interruptible.
- `ndxserver stop` posts to dashboard `/api/exit` and waits for the WebSocket
  endpoint to stop.
- Verdaccio latest moves from `0.1.25` to `0.1.26`.
- Installed binaries print `0.1.26`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, binary version, and
  help output.
- On Windows, run `ndxserver`, connect with `ndx`, exit the client, and verify a
  later `ndx` attaches without spawning a new server. Then run `ndxserver stop`.

## Locator Contract

No new browser surface. Existing dashboard locator contract is unchanged.
