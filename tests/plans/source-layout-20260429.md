# Test Plan: source-layout

## Created

2026-04-29

## Goal

Verify that the TypeScript source tree is reorganized into role-based folders
without changing runtime behavior.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through repository npm scripts

## Preconditions

- Dependencies are installed.
- Existing unrelated dirty files are ignored.

## Steps

1. Confirm `src` top level contains only role folders.
2. Run `npm run build`.
3. Run `npm test`.
4. Run CLI smoke with `node dist/src/cli/main.js --mock "list files"`.
5. Run `npm run deploy` after pushing the branch.

## Expected Results

- TypeScript imports resolve after file moves.
- Unit and integration tests pass.
- CLI entrypoint path works from the new `src/cli/main.ts` location.
- Docker deploy builds the pushed branch and runs in-container tests.

## Logs To Capture

- `npm run build` output.
- `npm test` TAP summary.
- CLI smoke output.
- `npm run deploy` result.

## Locator Contract

No browser UI exists for this package.
