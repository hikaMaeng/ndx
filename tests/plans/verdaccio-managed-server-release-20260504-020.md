# Test Plan: verdaccio-managed-server-release-020

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.20` to Verdaccio after expanding managed startup
diagnostics for unresolved Windows detached-server timeouts.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.20`.
- Verdaccio latest before publish is `0.1.19`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.20`.
8. Install `@neurondev/ndx@0.1.20` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Managed probe reports the failing stage instead of only returning false.
- CLI detached startup logs launcher metadata, spawned pid, repeated readiness
  probe status, and timeout details.
- Windows launcher records cwd, executable, args, set-location success, body
  invocation, and failure detail into the primary or temp diagnostic log.
- Deploy completes compose cleanup, sandbox rebuild, sandbox write verification,
  and teardown.
- Verdaccio latest moves from `0.1.19` to `0.1.20`.
- Installed binaries print `0.1.20`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.
- On Windows timeout, CLI stderr plus
  `%USERPROFILE%\.ndx\system\logs\managed-server.log` or
  `%TEMP%\ndx-managed-server.log`.

## Locator Contract

Not applicable; this release has no browser surface.
