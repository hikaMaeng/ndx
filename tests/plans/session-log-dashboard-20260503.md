# Test Plan: session-log-dashboard

## Created

2026-05-03

## Goal

Verify dashboard Session Logs can browse SQLite session records across accounts,
compose account/project/session filters, page raw session event records, and
soft-delete selected sessions.

## Environment

- Branch: `addsesstionlogindashboard`
- Runtime: Node.js with built `dist/`
- Dashboard target: local `SessionServer` dashboard listener
- Browser target: headless Chrome against `/dashboard`

## Preconditions

- `yarn install --immutable` has completed.
- Mock model sessions can be persisted through the socket server.
- The dashboard listener is reachable on localhost.

## Steps

1. Run `yarn build`.
2. Run `yarn test`.
3. Start a mock `SessionServer` with a temporary data directory.
4. Create accounts `alice` and `bob`, create sessions in two project cwd
   values, and wait for turns to complete.
5. Fetch `/api/session-log/facets` and verify account, project, and session
   facets.
6. Fetch `/api/session-log/sessions` with account/project/session filters and
   verify same-category OR plus cross-category AND behavior.
7. Fetch `/api/session-log/sessions/:id/events` with `offset` and `limit`.
8. DELETE one session through `/api/session-log/sessions/:id` and verify it is
   excluded from later list results.
9. Open `/dashboard` in headless Chrome and verify Session Logs controls and
   table rows render after client-side API loading.
10. Run `npm run deploy`.

## Expected Results

- Build and test commands pass.
- Facets include all persisted non-deleted sessions.
- Filters compose as documented.
- Event pages are ordered from oldest SQLite event id to newest.
- Delete is a soft delete and closes live subscribers when present.
- Dashboard markup exposes semantic controls and stable test ids.
- Deploy completes build, test, compose refresh, sandbox verification, and
  compose cleanup.

## Logs To Capture

- `yarn build`
- `yarn test`
- Headless Chrome DOM match output for Session Logs
- `npm run deploy`

## Locator Contract

- `main` named `Server Dashboard`
- `aside` named `Dashboard menu`
- Buttons: `Session Logs`, `Reload`, `Exit`
- Selects: `Account`, `Project`, `Session`
- Stable ids: `dashboard-session-logs`, `session-log-filter-tags`,
  `session-log-status`, `session-log-table`, `session-log-row`,
  `session-log-detail`, `session-log-events`
