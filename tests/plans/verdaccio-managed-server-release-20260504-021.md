# Test Plan: verdaccio-managed-server-release-021

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.21` to Verdaccio after adding timeout-time managed
startup log tailing and safe Windows server stdout/stderr capture.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.21`.
- Verdaccio latest before publish is `0.1.20`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.21`.
8. Install `@neurondev/ndx@0.1.21` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Windows launcher selects a writable diagnostic log path before server body
  redirection.
- Windows server stdout/stderr are captured only after a writable diagnostic log
  path is selected.
- CLI timeout output includes launcher PID status and diagnostic log tails or
  explicit missing-log messages.
- Verdaccio latest moves from `0.1.20` to `0.1.21`.
- Installed binaries print `0.1.21`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.
- On Windows timeout, CLI stderr including `[server-log]` lines.

## Locator Contract

Not applicable; this release has no browser surface.
