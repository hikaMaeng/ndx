# Test Plan: typescript-agent-loop

## Created

2026-04-29

## Goal

Verify the TypeScript agent loop remains executable after loop-state extraction,
abort propagation, runtime interrupt wiring, and worker abort handling.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Runtime: local Node/npm and repository Docker Compose stack

## Preconditions

- Dependencies are installed.
- Docker is available for `npm run deploy`.
- Existing unrelated working-tree changes are not staged by this task.

## Steps

1. Run `npm test`.
2. Run `npm run deploy`.
3. Confirm tests cover normal tool execution and pre-model abort behavior.
4. Confirm deploy path builds, refreshes Compose containers, runs tests in the
   agent container, and runs the mock verification command.

## Expected Results

- TypeScript build succeeds.
- Node tests pass.
- Deploy script completes without errors.
- No browser verification is required because this change has no UI surface.

## Logs To Capture

- `npm test` summary.
- `npm run deploy` completion result.
- Any TypeScript, Docker, or test failure output.

## Locator Contract

Not applicable. This change has no browser-rendered UI.
