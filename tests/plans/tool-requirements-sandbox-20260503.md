# Test Plan: tool-requirements-sandbox

## Created

2026-05-03

## Goal

Verify filesystem `tool.json` requirements parsing, core tool bootstrap
manifest output, non-core requirement aggregation, and Docker sandbox
dependency preparation contract.

## Environment

- Workspace: `/mnt/c/Users/hika0/.codex/worktrees/2b5c/ndx`
- Runtime: Node.js 22 through Yarn 4
- Docker target: `ndx-sandbox`

## Preconditions

- Dependencies installed with `yarn install --immutable`.
- Docker daemon is available for `npm run deploy`.
- The sandbox image may be rebuilt locally; publishing the new pinned image tag
  is a separate release operation.

## Steps

1. Build TypeScript with `yarn build`.
2. Run targeted tests for config bootstrap, tool registry, and Docker sandbox
   argv/path behavior.
3. Run the full test suite with `yarn test`.
4. Run `npm run deploy` to rebuild the sandbox image, refresh Compose, and
   execute the container smoke command.

## Expected Results

- Core tool manifests include their declared `requirements`.
- Unsupported manifest requirement keys are rejected.
- Project and plugin requirements are merged with duplicate removal and stable
  source metadata.
- Docker sandbox startup prepares only non-core filesystem requirements and
  can skip later installs by fingerprint.
- Deploy completes local build, tests, Compose refresh, sandbox build, sandbox
  smoke command, and teardown.

## Logs To Capture

- `yarn build` result.
- Targeted `node --test` TAP summary.
- `yarn test` TAP summary.
- `npm run deploy` output including Compose build and sandbox smoke result.

## Locator Contract

Not applicable. This package has no browser UI for this change.
