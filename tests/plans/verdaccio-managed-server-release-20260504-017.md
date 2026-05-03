# Test Plan: verdaccio-managed-server-release-017

## Created

2026-05-04

## Goal

Publish `@neurondev/ndx@0.1.17` to Verdaccio after replacing the Windows
managed server launcher with an encoded hidden PowerShell host that records
startup diagnostics.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Package manager: npm plus Yarn PnP for local build/test

## Preconditions

- Local package version is `0.1.17`.
- Verdaccio latest before publish is `0.1.16`.
- Registry credentials are available from the local npm configuration.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
6. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
7. Confirm Verdaccio latest is `0.1.17`.
8. Install `@neurondev/ndx@0.1.17` into an isolated prefix.
9. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Local build and tests pass.
- Deploy completes compose cleanup, sandbox rebuild, sandbox write verification,
  and teardown.
- Dry run includes the built `dist/` CLI and workspace launcher outputs.
- Verdaccio latest moves from `0.1.16` to `0.1.17`.
- Installed binaries print `0.1.17`.

## Logs To Capture

- Build, targeted test, full test, and deploy output.
- `npm view`, `npm pack --dry-run`, `npm publish`, install, and binary version
  output.

## Locator Contract

Not applicable; this release has no browser surface.
