# Test Plan: session-repository
## Created
2026-05-04

## Goal
Verify session identity, project UUID scoping, client ownership, lite metadata,
and session payload persistence after the repository schema cleanup.

## Environment
- Workspace: `/mnt/c/Users/hika0/.codex/worktrees/b2f2/ndx`
- Runtime: Node.js with experimental `node:sqlite`
- Package manager: Yarn 4.14.1
- Deploy target: `npm run deploy`

## Preconditions
- Dependencies are installed.
- Docker is available for `npm run deploy`.
- The test workspace can create temporary project folders and `.ndx/.project`
  files.

## Steps
1. Build the TypeScript workspace with `yarn build`.
2. Run focused session-server coverage for SQLite persistence, project identity,
   dashboard session logs, ownership, and lite mode.
3. Run full repository tests with `yarn test`.
4. Run `npm run deploy` to exercise the standard build, test, Docker compose
   refresh, and sandbox verification contract.
5. Inspect generated SQLite rows through tests for `session`, `sessiondata`,
   legacy session-table absence, context replay rows, and dashboard project
   filters.

## Expected Results
- `session` rows contain `userid`, UUID `projectid`, physical `path`, `islite`,
  `ownerid`, and `lastlogin`.
- `sessiondata` rows reference `session.rowid` and mirror persisted payload
  order.
- Legacy session-domain tables (`projects`, `sessions`, `session_events`,
  `session_context_*`, `session_owners`) are absent after schema reset.
- Deleting `.ndx/.project` and reusing the same path yields a different project
  id and excludes old-project sessions from current project listing.
- Distinct client owner ids trigger ownership reload and stale output discard.
- Dashboard project filters use project ids, not physical paths.
- `npm run deploy` completes build, tests, compose refresh, and sandbox command.

## Logs To Capture
- `yarn build`
- focused `node --test dist/tests/session-server.test.js --test-name-pattern ...`
- `yarn test`
- `npm run deploy`

## Locator Contract
Dashboard verification uses existing session-log markup:
- `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`
- `data-testid="dashboard-session-logs"`
- `data-testid="session-log-table"`
- session-log filter controls by label: `Account`, `Project`, `Session`
