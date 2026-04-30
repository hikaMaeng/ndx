# Test Plan: core-tool-bootstrap

## Created

2026-04-29

## Goal

Verify that startup bootstrap installs built-in capability tools as external
`tool.json` core packages instead of leaving only `shell` under
`/home/.ndx/core/tools`.

## Environment

- Host workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js, npm, Docker Compose
- Branch under test: current feature branch

## Preconditions

- Dependencies are installed.
- Docker is available for `npm run deploy`.
- The branch is pushed before Docker deploy because the Dockerfile clones
  `NDX_GIT_REF` from GitHub.

## Steps

1. Run `npm test`.
2. Confirm `ensureGlobalNdxHome()` installs required directories and all
   built-in core tool package manifests/runtimes without generating
   `settings.json`.
3. Confirm `ToolRegistry` exposes bootstrapped core capability tools from the
   `core` external layer.
4. Confirm `list_dir` and `tool_search` execute through the external manifest
   runner.
5. Push the branch and run `npm run deploy`.
6. Inspect Docker startup/session logs for `/home/.ndx/core/tools` bootstrap
   entries beyond `shell`.
7. After PR merge, switch to `main`, update it, and run `npm run deploy` again.

## Expected Results

- `npm test` passes.
- Docker deploy builds the pushed branch, runs in-container tests, and completes
  the mock agent verification.
- Startup bootstrap reports built-in core packages under
  `/home/.ndx/core/tools`.
- The same deploy path passes on `main` after merge.

## Logs To Capture

- `npm test` summary.
- Feature-branch `npm run deploy` result.
- PR URL and merge result.
- Main-branch `npm run deploy` result.
- Any Docker startup log lines showing core tool bootstrap.

## Locator Contract

No browser UI is rendered by this package.
