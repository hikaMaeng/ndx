# Test Plan: settings-version-wizard
## Created
2026-05-02
## Goal
Verify settings version ownership, silent version-only upgrades, wizard repair order, dashboard Reload compatibility, package version bump, and Verdaccio installed-package behavior.
## Environment
- Branch: `codex/settings-version-wizard`
- Package version: `0.1.7`
- Node.js with Yarn Plug'n'Play
- Docker available for `npm run deploy`
- Verdaccio registry: `https://verdaccio.neurondev.net/`
## Preconditions
- Global and project settings fixtures are temporary directories.
- The installed package verification uses an isolated npm prefix under `/tmp`.
- Any server started for verification uses loopback ports and is stopped by `POST /api/exit` or process cleanup.
## Steps
1. Run `yarn build`.
2. Run focused tests for config, settings wizard, and session-server dashboard Reload.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Publish `@neurondev/ndx@0.1.7` to Verdaccio.
6. Install `@neurondev/ndx@0.1.7` from Verdaccio into an isolated npm prefix.
7. Verify installed `ndx --version` and `ndxserver --version`.
8. Start installed `ndxserver` against temporary global and project settings with stale or missing `"version"` fields.
9. Verify startup updates both settings files to `0.1.7`.
10. Change one settings version back to a stale value, call dashboard `POST /api/reload`, and verify it updates to `0.1.7`.
## Expected Results
- Valid settings with stale or missing `"version"` are upgraded in place without prompts.
- Wizard tests repair global settings before project settings when required model/provider fields are missing.
- Dashboard Reload reuses the same config loader and updates settings versions.
- The installed Verdaccio package exposes version `0.1.7` through both binaries.
- Deploy completes build, tests, compose refresh, sandbox execution, and compose teardown.
## Logs To Capture
- Focused test TAP summary.
- Full `yarn test` summary.
- `npm run deploy` summary.
- Verdaccio publish and install output.
- Installed-server stdout lines for socket and dashboard URLs.
- Settings file versions before and after startup/reload.
## Locator Contract
No dashboard markup changes are introduced. Existing dashboard contract remains `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`, `role="status"`, `data-testid="dashboard-sources"`, and `data-testid="dashboard-bootstrap"`.
