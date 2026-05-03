# Test Plan: verdaccio-release

## Created

2026-05-04

## Goal

Verify that `@neurondev/ndx@0.1.15` is the next local package version after
Verdaccio `0.1.14`, publish it to `https://verdaccio.neurondev.net/`, and
confirm installed binaries report the new version.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Registry: `https://verdaccio.neurondev.net/`
- Shell: bash
- Docker available for deploy verification

## Preconditions

- `npm whoami --registry https://verdaccio.neurondev.net/` succeeds.
- Dependencies are installed with `yarn install --immutable`.
- Local package version is `0.1.15`.

## Steps

1. Query Verdaccio package versions with `npm view`.
2. Build and verify the full deploy path with `npm run deploy`.
3. Verify local built binaries with `node dist/src/cli/main.js --version` and
   `node dist/src/cli/main.js --mock --version`.
4. Run `npm pack --dry-run --registry https://verdaccio.neurondev.net/`.
5. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
6. Query Verdaccio package versions again.
7. Install `@neurondev/ndx@0.1.15` into an isolated prefix.
8. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results

- Verdaccio latest moves from `0.1.14` to `0.1.15`.
- Local and installed binaries print `0.1.15`.
- Deploy completes build, tests, compose refresh, sandbox rebuild, sandbox write
  verification, and compose teardown.

## Logs To Capture

- Verdaccio versions before and after publish.
- Deploy output.
- Dry-run package file list and tarball metadata.
- Publish package name, version, shasum, and registry.
- Installed binary version output.

## Locator Contract

Not applicable; this release verification has no browser surface.
