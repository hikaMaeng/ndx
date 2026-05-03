# Test Plan: docs-config-refactor

## Created

2026-05-03

## Goal

Verify the docs cleanup, centralized runtime defaults, and boundary refactoring
preserve current ndx behavior while keeping dashboard markup browser-testable.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: bash
- Package manager: Yarn Plug'n'Play
- Deploy entrypoint: `npm run deploy`

## Preconditions

- Dependencies are already available through the repository lockfile.
- Docker and Docker Compose are available for deploy verification.
- Browser verification may use Playwright CLI or an HTML/DOM fetch fallback.

## Steps

1. Run `yarn build`.
2. Run `yarn test`.
3. Run `npm run deploy`.
4. Start a mock server with dashboard HTTP enabled on local loopback ports.
5. Verify `GET /dashboard` exposes the documented dashboard locator contract.
6. Confirm only `README.md` and the required seven `docs/*.md` files remain.

## Expected Results

- TypeScript compiles without errors.
- Node tests pass.
- Deploy completes build, tests, compose cleanup, sandbox rebuild, sandbox write,
  and compose teardown.
- Dashboard HTML exposes stable semantic and test-id locators.
- Removed legacy/Codex/Rust/TUI docs are no longer tracked.

## Logs To Capture

- Build/test/deploy command result.
- Mock server socket and dashboard URLs.
- Dashboard HTTP status and locator assertions.
- Any failures and reproducibility details.

## Locator Contract

- `main[aria-labelledby="dashboard-title"][data-testid="ndx-dashboard"]`
- `aside aria-label="Dashboard menu"`
- `nav aria-label="Server actions"`
- buttons named `Reload` and `Exit`
- `role="status"` or `role="alert"` for action output
- `data-testid="dashboard-sources"`
- `data-testid="dashboard-bootstrap"`
