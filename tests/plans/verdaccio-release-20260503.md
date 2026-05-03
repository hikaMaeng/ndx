# Test Plan: verdaccio-release
## Created
2026-05-03

## Goal
Verify that `@neurondev/ndx@0.1.13` is the next local package version after
Verdaccio `0.1.12`, publish it to `https://verdaccio.neurondev.net/`, and
confirm installed binaries report the new version.

## Environment
- Repository: `/mnt/f/dev/ndx`
- Package: `@neurondev/ndx@0.1.13`
- Registry: `https://verdaccio.neurondev.net/`
- Deploy entrypoint: `npm run deploy`

## Preconditions
- Worktree is clean or only contains this release verification record.
- `npm whoami --registry https://verdaccio.neurondev.net/` succeeds.
- Verdaccio latest for `@neurondev/ndx` is lower than `0.1.13`.

## Steps
1. Query Verdaccio package versions with `npm view`.
2. Run `npm run deploy`.
3. Verify local built binaries with `node dist/src/cli/main.js --version` and
   `node dist/src/cli/main.js --mock --version`.
4. Run `npm pack --dry-run`.
5. Publish with `npm publish --registry https://verdaccio.neurondev.net/`.
6. Query Verdaccio package versions again.
7. Install `@neurondev/ndx@0.1.13` into an isolated npm prefix.
8. Verify installed `ndx --version` and `ndxserver --version`.

## Expected Results
- `npm run deploy` builds, runs tests, rebuilds the compose sandbox, verifies a
  sandbox write, and tears the compose stack down.
- Verdaccio latest becomes `0.1.13`.
- Installed `ndx` and `ndxserver` both print `0.1.13`.

## Logs To Capture
- Verdaccio versions before and after publish.
- Deploy test summary and compose result.
- Publish package name, version, shasum, and registry.
- Installed binary version output.

## Locator Contract
N/A. This release verification does not change or exercise the dashboard browser
surface.
