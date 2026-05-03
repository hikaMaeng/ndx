# Test Plan: docker-tool-root-audit

## Created

2026-05-03

## Goal

Verify that sandboxed tool execution maps model-selected `/root` paths to the
active workspace and records detailed Docker tool audit logs.

## Environment

- OS shell: bash
- Workspace: `/mnt/f/dev/ndx`
- Package: `@neurondev/ndx@0.1.12`
- Registry: `https://verdaccio.neurondev.net/`
- Sandbox image: `hika00/ndx-sandbox:0.1.1`

## Preconditions

- Docker is available.
- Yarn dependencies are installed.
- Verdaccio authentication is configured for publish.

## Steps

1. Run `yarn build`.
2. Run `node --test dist/tests/tools.test.js dist/tests/cli-session-client.test.js`.
3. Run a direct Docker sandbox smoke test that executes `shell` with
   `cwd: "/root"` and writes `root-alias-smoke.txt`.
4. In that smoke test, inspect the host workspace file, sandbox
   `/home/.ndx/system/logs/tool-executions.jsonl`, and `docker logs`.
5. Run `yarn test`.
6. Run `npm run deploy`.
7. Publish `@neurondev/ndx@0.1.12` to Verdaccio.
8. Install `@neurondev/ndx@0.1.12` from Verdaccio into an isolated prefix and
   verify `ndx --version` and `ndxserver --version`.

## Expected Results

- `/root` and `/root/...` tool paths resolve to the active workspace.
- Files written by a `/root` cwd shell command appear in the host workspace.
- Sandbox audit JSONL contains start and finish records.
- `docker logs <container>` shows the same audit records.
- Focused tests, full tests, and deploy pass.
- Installed binaries report `0.1.12`.

## Logs To Capture

- Focused TAP output.
- Direct Docker smoke JSON summary with cwd, host file result, audit line count,
  and Docker log line count.
- Full TAP output.
- Deploy output.
- Verdaccio publish output.
- Install verification versions.

## Locator Contract

Not applicable. No browser UI is changed.
