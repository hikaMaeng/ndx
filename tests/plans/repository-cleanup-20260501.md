# Test Plan: Repository Cleanup

## Created

2026-05-01

## Goal

Verify the repository cleanup keeps the maintained ndx TypeScript package
buildable, testable, deployable, and browser-verifiable after removing legacy
workspace clutter.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Package manager: Yarn 4.14.1 with Plug'n'Play and global cache
- Node.js: repository `engines.node` requires `>=22`
- Docker Compose: required for `npm run deploy`

## Preconditions

- The cleanup branch contains only the intended tracked removals, docs updates,
  ignore-file updates, and lockfile pruning.
- Local dependency, build, editor, and Docker runtime artifacts are not tracked.
- The current branch is available to the Docker build path selected by
  `NDX_GIT_REF`.

## Steps

1. Run `yarn install --immutable`.
2. Run `yarn test`.
3. Run `npm run deploy`.
4. Start the built service or reuse the deploy image to verify the dashboard
   placeholder in a browser-capable check.
5. Confirm removed legacy references do not remain in active docs, configs,
   source, tests, or lockfile.

## Expected Results

- Dependency installation succeeds from the pruned root lockfile.
- `npm test` succeeds.
- `npm run deploy` succeeds and refreshes the compose stack.
- Dashboard placeholder exposes the expected browser locator contract.
- No active references remain for removed SDK, Bazel, devcontainer, release, or
  third-party artifacts.

## Logs To Capture

- Dependency install summary.
- `npm test` result.
- `npm run deploy` result and any Docker failure detail.
- Browser locator check result.
- Reference scan result.

## Locator Contract

- `main` landmark named by the visible `ndx Agent Service` heading.
- `role="status"` on placeholder status text.
- `data-testid="agent-dashboard-placeholder"` on the placeholder root.
