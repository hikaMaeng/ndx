# Test Plan: verdaccio-managed-server-release-024

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.24` to Verdaccio after moving the `ndxserver` bin to
a dedicated bootstrap entrypoint that explicitly marks the process as server
invoked.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.24`.
- Verdaccio latest before publish is `0.1.23`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.24`.
8. Install `@neurondev/ndx@0.1.24` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Package `bin.ndxserver` points to `dist/src/cli/ndxserver.js`.
- The bootstrap sets `NDX_INVOKED_AS_SERVER=1` before importing the shared CLI
  main module.
- Windows plain `ndxserver` does not enter the interactive login client flow.
- Verdaccio latest moves from `0.1.23` to `0.1.24`.
- Installed binaries print `0.1.24`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.
- On Windows, plain `ndxserver` startup output through readiness and endpoint
  reporting.

## Locator Contract

Not applicable; this release has no browser surface.
