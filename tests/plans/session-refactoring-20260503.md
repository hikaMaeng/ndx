# Test Plan: session-refactoring

## Created

2026-05-03

## Goal

Verify the session refactor keeps WebSocket session behavior stable while SQLite
uses indexed projections and context replay rows, Docker sandbox run args remain
deterministic, and split server modules preserve the public `SessionServer`
entrypoint.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Branch: `refactoring260503`
- Runtime: Node.js through Yarn Plug'n'Play
- Docker: local Docker Compose target `ndx-sandbox`

## Preconditions

- `main` is pushed to `origin`.
- Working tree contains the refactor changes and updated docs.
- Docker daemon is available for `npm run deploy`.

## Steps

1. Run `yarn build`.
2. Run targeted tests: `node --test dist/tests/cli-workspace.test.js dist/tests/session-server.test.js`.
3. Run full tests with `yarn test`.
4. Run deploy verification with `npm run deploy`.
5. Inspect Git status and commit the verified changes.

## Expected Results

- TypeScript build succeeds.
- Targeted and full Node test suites pass.
- SQLite tests observe session projection `event_count`, `last_event_id`, and
  ordered `session_context_items`.
- Docker sandbox tests observe the rendered run-argv contract.
- Deploy completes build, tests, compose cleanup, image build, sandbox exec
  smoke, and final compose cleanup.

## Logs To Capture

- Build command and exit status.
- Targeted and full test summaries.
- Deploy summary including compose down/build/up/exec/down.
- Any failure output with the failing command.

## Locator Contract

No new browser flow is introduced. Existing dashboard tests continue to verify
the server-rendered dashboard shell and stable test ids.
