# Test Plan: verdaccio-dashboard-login-release
## Created
2026-05-05

## Goal
Publish a Verdaccio patch release that contains the merged dashboard
improvements and local-only CLI login prompt.

## Environment
- Repository: `ndx`
- Branch: `main`
- Registry: `https://verdaccio.neurondev.net/`
- Version: `0.1.27`

## Preconditions
- `origin/main` contains the dashboard overview/users changes.
- Source CLI startup login has no `New Google login` menu entry.
- Dependencies are installed with `yarn install --immutable`.

## Steps
1. Bump package and settings example version to `0.1.27`.
2. Run `yarn install --immutable`.
3. Run `yarn build`.
4. Run `yarn test`.
5. Run `npm run deploy`.
6. Verify built `dist/` does not contain `New Google login`.
7. Publish to Verdaccio.
8. Install `@neurondev/ndx@0.1.27` into an isolated prefix and verify
   `ndx --version`, `ndxserver --version`, and package contents.

## Expected Results
- Build, tests, and deploy pass.
- Verdaccio exposes `@neurondev/ndx@0.1.27`.
- Installed package reports `0.1.27`.
- Built CLI login prompt offers local account choices only.

## Logs To Capture
- `yarn build`
- `yarn test`
- `npm run deploy`
- `npm publish`
- `npm view`
- isolated install and binary version output

## Locator Contract
Dashboard browser locator contract remains documented in `docs/testing.md`.
This release does not change the dashboard DOM beyond the already merged
dashboard work.
