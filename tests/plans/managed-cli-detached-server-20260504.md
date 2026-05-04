# Test Plan: managed-cli-detached-server

## Created

2026-05-04

## Goal

Verify normal `ndx` managed startup starts an independent `ndxserver` process
when the default WebSocket endpoint is unreachable, while preserving attach to
an already-running server.

## Environment

- Repository: `/mnt/f/dev/ndx`
- Runtime: Node.js with Yarn PnP
- Shell: bash
- Docker available for deploy verification

## Preconditions

- Dependencies are installed with `yarn install --immutable`.
- No unrelated process is bound to the tested WebSocket port.
- The default dashboard port is not overridden unless explicitly testing
  `NDX_DASHBOARD_PORT`.

## Steps

1. Build TypeScript with `yarn build`.
2. Run `node --test dist/tests/cli-workspace.test.js`.
3. Run `yarn test`.
4. Run `npm run deploy`.
5. Inspect the managed launcher unit coverage for Windows, macOS, and Linux.
6. For manual runtime verification, start `ndx` against an unused socket
   address, exit the CLI, and confirm the server socket still accepts a later
   connection until the server is explicitly stopped.

## Expected Results

- Managed discovery returns reachable state for an existing session server.
- Managed fallback reports default dashboard port `45124` when
  `NDX_DASHBOARD_PORT` is unset.
- CLI managed fallback spawns server mode instead of embedding a
  `SessionServer` that closes during CLI cleanup.
- Windows launcher uses a direct hidden detached Node process and writes
  stdout/stderr to `%TEMP%\ndx-managed-server-host.log` when possible; macOS
  launcher uses `nohup`; Linux launcher uses `setsid` with `nohup` fallback.
- The package maps `ndxserver` to a dedicated bootstrap entrypoint so Windows
  npm shims do not have to preserve the original binary name.
- Managed launchers set `NDX_MANAGED_SERVER=1`, and managed server mode ignores
  `SIGINT` so client Ctrl+C does not stop the background server.
- `ndxserver stop` requests dashboard `/api/exit` and waits for the WebSocket
  endpoint to become unreachable.
- CLI startup logs include launcher type, detached command metadata, server
  args, spawned pid, readiness attempt count, failed probe stage, and last probe
  error.
- Timeout diagnostics include launcher PID status and readable managed log
  tails.
- Windows timeout diagnostics also include the host log at
  `%TEMP%\ndx-managed-server-host.log` when that file can be opened.
- Deploy completes build, tests, compose cleanup, sandbox rebuild, sandbox
  write verification, and compose teardown.

## Logs To Capture

- `yarn build` output.
- `node --test dist/tests/cli-workspace.test.js` TAP output.
- `yarn test` TAP output.
- `npm run deploy` output.
- Windows `%USERPROFILE%\.ndx\system\logs\managed-server.log` when startup
  times out.
- Windows `%TEMP%\ndx-managed-server.log` when the primary managed log path is
  not writable.

## Locator Contract

Not applicable; this behavior has no browser surface.
