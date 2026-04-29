# Test Plan: main-compose-session-scenarios

## Created

2026-04-30

## Goal

Verify the `main` Docker Compose image while it is running, with direct session
flows for deletion, existing-session restore, and mid-turn session ownership
replacement.

## Environment

- Workspace: `/tmp/ndx-main-compose-update`
- Branch: `codex/main-compose-session-validation`
- Base: `origin/main` at `cb56493f3256c4f777b92aafff26baed67f92831`
- Shell: bash
- Docker image: `ndx-agent:local`
- Service: `ndx-agent` from `docker compose up -d ndx-agent`

## Preconditions

- `origin/main` contains the merged session deletion and restore changes.
- Compose builds with `NDX_GIT_REF=main`.
- The running container has `/opt/ndx` cloned from `main`.

## Steps

1. Run `docker compose down --remove-orphans`.
2. Run `NDX_GIT_REF=main docker compose build --no-cache ndx-agent`.
3. Run `docker compose up -d ndx-agent`.
4. Confirm the running container reports commit
   `cb56493f3256c4f777b92aafff26baed67f92831` on branch `main`.
5. Copy `tests/session-image-scenarios.mjs` into the running container.
6. Run `node /tmp/session-image-scenarios.mjs` from `/opt/ndx`.
7. Run `npm test` inside the running container.
8. Confirm the service remains up.

## Expected Results

- The running image is built from `main`.
- Three sessions are created and numbered `[1, 2, 3]`.
- Restoring session `1` succeeds and persisted events are readable.
- Delete candidates exclude the current restored session and include `[2, 3]`.
- Deleting session `2` removes only that session and leaves `[1, 3]`.
- A stale owner touching deleted session `2` receives `session/deleted`.
- A blocked mid-turn session can be restored by another server, stale output is
  discarded, and the new owner can continue the session.
- In-container `npm test` passes.

## Logs To Capture

- Compose build/up output
- Container git commit and branch
- `tests/session-image-scenarios.mjs` JSON output
- In-container `npm test`
- `docker compose ps`

## Locator Contract

Not applicable. The package has no browser UI.
