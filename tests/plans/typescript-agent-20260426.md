# Test Plan: typescript-agent

## Created

2026-04-26

## Goal

Verify the TypeScript ndx CLI builds, loads `.ndx` config, executes the shell tool through the mock model loop, and passes Docker compose deployment verification.

## Environment

- OS: Ubuntu 24.04 on WSL2
- Node: 22.22.2
- pnpm: 10.33.0
- Docker: 29.3.1
- Compose: v5.1.0

## Preconditions

- Dependencies installed with `pnpm install --registry=https://registry.npmjs.org` when local Verdaccio is unavailable.
- No OpenAI API key required for mock verification.

## Steps

1. Run `npm test`.
2. Run `npm run deploy`.
3. Confirm Docker build completes for `ndx-agent:local`.
4. Confirm in-container `npm test` passes.
5. Confirm in-container mock agent creates `tmp/ndx-docker-verify.txt` with `verified` through the shell tool.

## Expected Results

- TypeScript compilation succeeds.
- Node tests report 4 passing tests.
- Docker compose removes previous containers, builds the image, runs tests, runs the mock agent, and tears down the network.
- Mock shell result reports `exitCode: 0` and `stdout: "verified"`.

## Logs To Capture

- `npm test` TAP summary.
- `npm run deploy` Docker build summary.
- Mock agent `[tool:shell]` and `[tool:result]` stderr lines.

## Locator Contract

Not applicable. This package has no browser UI.
