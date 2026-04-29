# Test Plan: session-delete-compose

## Created

2026-04-30

## Goal

Verify session deletion, ownership handoff, stale socket termination, and Docker
Compose deployment stay stable after the delete-session branch is rebuilt from a
fresh branch.

## Environment

- Workspace: `/tmp/ndx-delete-session-verify`
- Branch: `codex/delete-session-compose-update`
- Shell: bash
- Runtime: Node.js tests and Docker Compose `ndx-agent`

## Preconditions

- The branch is pushed to `https://github.com/hikaMaeng/ndx.git`.
- Docker Compose can build `ndx-agent` from `NDX_GIT_REF`.
- No unrelated dirty changes are staged from `/mnt/f/dev/ndx`.

## Steps

1. Run `npm test`.
2. Run the Docker-mounted focused race test for
   `session ownership discards in-flight output`.
3. Run `npm run deploy`.
4. Confirm the deploy build clones
   `codex/delete-session-compose-update`.
5. Confirm in-container `npm test` passes.
6. Confirm the in-container mock `ndx --mock` command writes
   `tmp/ndx-docker-verify.txt`.
7. Confirm `docker compose down --remove-orphans` removes the compose network.

## Expected Results

- Local tests pass.
- Docker-mounted focused race test passes without timeout.
- Compose build, in-container tests, mock CLI run, and final compose cleanup
  all pass.
- No browser verification is required because this package has no browser UI.

## Logs To Capture

- `npm test`
- Docker-mounted focused race test output
- `npm run deploy`

## Locator Contract

Not applicable. The package has no browser UI.
