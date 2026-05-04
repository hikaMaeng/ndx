# Test Plan: local-account-system
## Created
2026-05-04
## Goal
Verify local-only account creation, lowercase id normalization, SQLite
last-login selection, block/unblock behavior, protected default account rules,
and removal of OAuth/password-dependent login paths.
## Environment
- Workspace: `/mnt/c/Users/hika0/.codex/worktrees/e391/ndx`
- Node: repository engine `>=22`
- Package manager: Yarn 4 Plug'n'Play
- SQLite: Node `node:sqlite`
## Preconditions
- `yarn install --immutable` succeeds.
- No external OAuth provider credentials are required.
- Docker is available only for `npm run deploy`.
## Steps
1. Run `yarn build`.
2. Run `node --test dist/tests/session-server.test.js dist/tests/cli-session-client.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. In session-server coverage, confirm `account/create` lowercases ids, `account/login` updates `lastlogin`, `account/previous` returns the latest non-blocked account, `/blockuser` blocks non-protected ids, `/unblockuser` restores them, `defaultuser` cannot be blocked, and blocking the current account returns an exit action.
6. In CLI coverage, confirm startup/login prompts use local account choices and no Google/GitHub device login request is issued.
## Expected Results
- All commands exit `0`.
- Created account ids contain only lowercase letters and digits.
- Blocked users cannot log in.
- Protected `defaultuser` remains usable and cannot be blocked or unblocked.
- Client auth file state is not used for previous-account selection.
## Logs To Capture
- Build output.
- Node test TAP output.
- Full `yarn test` output.
- Deploy build/test/compose output.
## Locator Contract
No new browser surface is introduced. Dashboard locator contract remains:
`main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`, `nav`
named `Server actions`, buttons named `Reload` and `Exit`, and status/alert
action output.
