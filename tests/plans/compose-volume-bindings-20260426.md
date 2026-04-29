# Test Plan: compose-volume-bindings

## Goal

Verify Docker Compose exposes persistent host bind mounts under `./docker/volume` for the runtime workspace and global ndx settings while Docker build still clones the selected remote branch.

## Environment

- OS: Ubuntu 24.04 on WSL2
- Node: 22.22.2
- Docker: 29.3.1
- Compose: v5.1.0
- Git branch: `codex/compose-volume-bindings`

## Preconditions

- The feature branch is committed and pushed before Docker remote-clone verification.
- Docker daemon is running.
- `NDX_GIT_REF` points to the branch under test.

## Steps

1. Run `npm test` locally.
2. Commit and push `codex/compose-volume-bindings`.
3. Run `npm run deploy`.
4. Run `NDX_GIT_REF=codex/compose-volume-bindings docker compose up -d --build ndx-agent`.
5. Run `docker compose exec -T ndx-agent sh -lc 'pwd && test -d /opt/ndx && test -d /workspace && test -d /home/.ndx && ndx --help'`.
6. Run a mock agent task and confirm the output file appears under `docker/volume/workspace` on the host.

## Expected Results

- Compose build args include only `NDX_GIT_REF`.
- Docker build logs show the selected branch clone from GitHub.
- Runtime `/workspace` is backed by `./docker/volume/workspace`.
- Runtime `/home/.ndx` is backed by `./docker/volume/home-ndx`.
- `ndx` remains executable because the app is installed under `/opt/ndx`, not hidden by the workspace volume.

## Logs To Capture

- Local `npm test` TAP output.
- Docker build clone line.
- Compose volume mount inspection.
- Mock agent output and host workspace file check.
