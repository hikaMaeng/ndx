# Test Plan: session-tools-layout

## Created

2026-04-29

## Goal

Verify that the TypeScript source tree has no top-level `src/tools` folder and
that session-owned built-in tools live under `src/session/tools`.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: Node.js 22+ through repository npm scripts

## Preconditions

- Dependencies are installed.
- Existing unrelated dirty files are ignored.

## Steps

1. Move `src/tools` to `src/session/tools`.
2. Update imports in agent loop, session tool modules, and tests.
3. Confirm `find src -maxdepth 1 -type f` and `find src -maxdepth 1 -type d` show no top-level tools file/domain.
4. Run `npm run build`.
5. Run `npm test`.
6. Run CLI smoke with `node dist/src/cli/main.js --mock "list files"`.
7. Run `npm run deploy` after pushing the branch.

## Expected Results

- No `src/tools` path remains.
- TypeScript imports resolve after the move.
- Tool registry, worker, MCP, and task tool tests still pass.
- Docker deploy builds the pushed branch and runs in-container tests.

## Logs To Capture

- `npm run build` output.
- `npm test` TAP summary.
- CLI smoke output.
- `npm run deploy` result.

## Locator Contract

No browser UI exists for this package.
