# Test Plan: model-process-bootstrap

## Created

2026-04-29

## Goal

Verify provider adapter abstraction, standalone process/task queue behavior, global `.ndx` bootstrap, and existing session tool orchestration continue to work.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Shell: bash
- Node test runner through `npm test`
- Docker deploy through `npm run deploy`

## Preconditions

- Dependencies are installed.
- Docker is available for deploy verification.
- Current branch is pushed before deploy because the Dockerfile clones `NDX_GIT_REF`.

## Steps

1. Run `npm run build`.
2. Run `npm test`.
3. Run `npm run deploy`.
4. Inspect changed docs for provider, process, bootstrap, and tool ownership contracts.
5. Confirm Git commit contains implementation, docs, tests, and report.

## Expected Results

- TypeScript compilation succeeds.
- Unit/integration tests pass.
- Deploy builds the image, refreshes compose containers, runs in-container tests, runs mock agent verification, and tears compose down.
- No browser verification is required because this package has no frontend view.

## Logs To Capture

- Build output.
- Node test TAP summary.
- Deploy summary including Docker compose refresh and mock agent result.

## Locator Contract

No browser UI exists; browser locator contracts are not applicable.
