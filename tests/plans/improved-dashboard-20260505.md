# Test Plan: improved-dashboard
## Created
2026-05-05

## Goal
Verify the dashboard overview, separate session log/detail views, and Users view
reflect current SQLite account and session state.

## Environment
- Repository: `ndx`
- Branch: `improvedashboard`
- Runtime: Node.js 22+, Yarn 4 Plug'n'Play
- Deploy target: `npm run deploy`

## Preconditions
- Dependencies installed with `yarn install --immutable`.
- Local Docker daemon is available for deploy verification.
- Test data includes at least two local accounts and multiple persisted
  sessions.

## Steps
1. Run `yarn build`.
2. Run `yarn test`.
3. Run `npm run deploy`.
4. Start a local mock `SessionServer` test fixture and fetch `/dashboard`.
5. Fetch `/api/dashboard/summary` and verify account, session, event, live
   session, and client counts.
6. Fetch `/api/dashboard/users` and verify `userid`, `lastlogin`, block and
   protected state, session count, project count, event count, and latest
   session timestamp.
7. Fetch session log facets, filtered sessions, a session event page, and delete
   one session by id.
8. Browser-check the deployed dashboard DOM for the documented locator contract.

## Expected Results
- Overview metrics include account and session statistics.
- Session Logs, Session Detail, and Users are separate right-main views.
- User rows include last login and session activity counts.
- Session log filtering, detail paging, and deletion continue to work.
- Deploy rebuilds, refreshes compose resources, verifies the sandbox, and exits
  successfully.

## Logs To Capture
- `yarn build`
- `yarn test`
- `npm run deploy`
- Dashboard HTTP status and API response excerpts
- Browser locator verification output

## Locator Contract
- `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`
- `aside aria-label="Dashboard menu"`
- `nav aria-label="Dashboard views"`
- Buttons named `Overview`, `Session Logs`, `Users`, `Reload`, and `Exit`
- `data-testid="dashboard-server-stats"`
- `data-testid="dashboard-session-logs"` and `data-testid="session-log-table"`
- `data-testid="session-log-detail"` and `data-testid="session-log-events"`
- `data-testid="dashboard-users"` and `data-testid="users-table"`
