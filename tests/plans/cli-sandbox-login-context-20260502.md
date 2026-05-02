# Test Plan: cli-sandbox-login-context

## Created

2026-05-02

## Goal

Verify startup login selection, server version/protocol display, compact
bootstrap logs, restored-context reporting, and Docker sandbox rebinding for
tool execution.

## Environment

- Workspace: `/mnt/f/dev/ndx`
- Shell: Bash
- Package manager: Yarn 4.14.1
- Node: repository engine `>=22`

## Preconditions

- Dependencies are installed with `yarn install --immutable`.
- Docker is available for `npm run deploy`.
- No real Google OAuth token is required for automated tests.

## Steps

1. Run `yarn build`.
2. Run targeted tests:
   `node --test dist/tests/cli-session-client.test.js dist/tests/runtime.test.js dist/tests/tools.test.js dist/tests/tool-orchestration.test.js dist/tests/session-server.test.js`.
3. Run the full test suite with `yarn test`.
4. Run `npm run deploy` to verify build, tests, compose refresh, sandbox image
   build, sandbox execution, and compose teardown.
5. Inspect generated CLI/session logs for server version, protocol, login,
   compact bootstrap, and restored-context lines.

## Expected Results

- CLI initialization prints `ndx-ts-session-server <version>` and protocol `1`.
- Interactive startup prompts before login and hides previous login when it is
  `defaultUser`.
- Bootstrap output groups each tool package on one line.
- Session initialization includes restored item count and token estimate over
  model context when available.
- Restored sessions rebind to the current Docker sandbox before handling turns.
- Deploy completes and writes the sandbox verification file before teardown.

## Logs To Capture

- Build and test command results.
- `npm run deploy` compose build/up/exec/down result.
- Any failed assertion or Docker error.

## Locator Contract

Not a browser-facing change. Existing dashboard locator contract is unchanged.
