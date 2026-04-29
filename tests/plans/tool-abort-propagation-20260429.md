# Test Plan: tool-abort-propagation
## Created
2026-04-29

## Goal
Verify that interrupting an agent turn cancels the worker process and the immediate external `tool.json` command process.

## Environment
- OS shell: bash
- Runtime: Node.js 22 through package scripts
- Package: root `ndx`

## Preconditions
- Dependencies are installed.
- Global `/home/.ndx` may exist; tests create isolated temporary tool roots.
- Docker is available for `npm run deploy`.

## Steps
1. Run `npm test`.
2. Confirm `agent abort signal propagates to external tool processes` passes.
3. Run `npm run deploy`.
4. Confirm the Docker build clones the selected Git branch, runs in-container `npm test`, and runs the mock agent verification.

## Expected Results
- All Node tests pass.
- The abort propagation test observes a ready marker from the external tool and an abort marker after the turn signal is aborted.
- Deploy completes without leaving the compose stack running.

## Logs To Capture
- `npm test` TAP summary.
- `npm run deploy` build, in-container test, mock agent, and compose-down summary.

## Locator Contract
No browser UI exists for this package. Browser locator contracts are not applicable.
