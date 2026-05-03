# Test Plan: docs-config-refactor-merge

## Created

2026-05-03

## Goal

Verify that `codex/docs-config-refactor` merges into `main` without unresolved
conflicts, keeps the centralized runtime defaults aligned with the deployed
sandbox image, and preserves the repository deploy contract.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Node/Yarn: repository `package.json` engines
- Docker: local Docker Compose target `ndx-sandbox`

## Preconditions

- Local `main` is fast-forwarded to `origin/main`.
- `codex/docs-config-refactor` exists locally.
- Docker daemon is available.

## Steps

1. Merge `codex/docs-config-refactor` into `main`.
2. Resolve TypeScript and documentation conflicts.
3. Run `yarn build`.
4. Run the focused tool orchestration test if full deploy exposes a merge-only
   failure.
5. Run `npm run deploy`.
6. Confirm Git reports no unresolved paths.

## Expected Results

- `yarn build` exits 0.
- Focused tool orchestration test exits 0 when run.
- `npm run deploy` exits 0 after build, test, compose down, no-cache sandbox
  image build, compose up, sandbox file-write check, and compose down.
- Default sandbox image remains `hika00/ndx-sandbox:0.1.1` across code and
  active docs.

## Logs To Capture

- `yarn build` exit status.
- Focused `node --test dist/tests/tool-orchestration.test.js` exit status.
- `npm run deploy` pass/fail summary, including Node test count and Docker
  compose lifecycle result.

## Locator Contract

Not applicable. This merge verification does not run browser UI checks.
