# Test Plan: session-context-management
## Created
2026-05-03

## Goal
Verify `/lite` and `/compact` session context controls preserve full SQLite
records while changing only provider-facing model context.

## Environment
- Workspace: `/mnt/f/dev/ndx`
- Runtime: Node.js with `node:sqlite`
- Branch: `improvecontext`

## Preconditions
- Dependencies installed with Yarn Plug'n'Play.
- `system/tools/shell` test fixture can be written under a temporary global
  `.ndx` directory.

## Steps
1. Build TypeScript with `yarn build`.
2. Run session-server tests covering restore, lite, compact, ownership, and
   SQLite context persistence.
3. Run full `yarn test`.
4. Run `npm run deploy` to execute build, tests, Compose refresh, sandbox
   image build, sandbox smoke, and Compose teardown.

## Expected Results
- `/lite on` removes completed prior `tool_call` and `tool_result` items from
  the next model input only.
- `/lite off` refuses expansion when active model `maxContext` would be
  exceeded.
- `/compact` writes `context_compact` and future model input starts with the
  compact summary plus later turns.
- SQLite still contains runtime tool records, compatibility context rows, and
  partition context rows.

## Logs To Capture
- Build/test command result.
- Targeted session-server test result.
- Full `yarn test` result.
- `npm run deploy` result, including Docker Compose refresh.

## Locator Contract
No browser surface changed.
