# Test Plan: verdaccio-managed-server-release-023

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.23` to Verdaccio after changing Windows managed
startup so plain `ndxserver` is a background server trigger and the detached
launcher starts Node directly instead of through PowerShell.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.23`.
- Verdaccio latest before publish is `0.1.22`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.23`.
8. Install `@neurondev/ndx@0.1.23` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Windows launcher metadata reports `windows-service-trigger-node`.
- Windows detached launch command is `node.exe` with `serve` args.
- Plain Windows `ndxserver` acts as a background trigger; `ndxserver serve`
  remains the foreground server mode.
- Verdaccio latest moves from `0.1.22` to `0.1.23`.
- Installed binaries print `0.1.23`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.
- On Windows timeout, CLI stderr including
  `%TEMP%\ndx-managed-server-host.log` tail.

## Locator Contract

Not applicable; this release has no browser surface.
