# Test Plan: docker-remote-clone-build

## Goal

Verify the Dockerfile builds ndx by cloning a selected remote Git branch instead of copying local source folders from the build context.

## Environment

- OS: Ubuntu 24.04 on WSL2
- Node: 22.22.2
- Docker: 29.3.1
- Compose: v5.1.0
- Git branch: `codex/docker-remote-clone-build`

## Preconditions

- The feature branch is committed and pushed before Docker remote-clone verification.
- Docker daemon is running.
- `NDX_GIT_REF` points to the branch under test.
- `NDX_GIT_CACHE_BUST` points to the commit under test.

## Steps

1. Run `npm test` locally before committing.
2. Commit and push `codex/docker-remote-clone-build`.
3. Run `NDX_GIT_REF=codex/docker-remote-clone-build NDX_GIT_CACHE_BUST=<commit> docker compose build ndx-agent`.
4. Run `docker compose run --rm ndx-agent npm test`.
5. Run `docker compose run --rm ndx-agent node dist/src/cli.js --mock "create a file named tmp/ndx-docker-verify.txt with text verified"`.
6. Run `docker compose up -d ndx-agent` and `docker compose exec -T ndx-agent ndx --help`.

## Expected Results

- Docker build logs show `Building ndx from https://github.com/hikaMaeng/ndx.git@codex/docker-remote-clone-build`.
- Docker build succeeds without `COPY src`, `COPY docs`, `COPY tests`, or `COPY .ndx` from the local build context.
- In-container tests pass.
- In-container mock agent writes `verified` through the shell tool.
- `ndx --help` is available from `/usr/local/bin/ndx`.

## Logs To Capture

- Local `npm test` TAP output.
- Push result for the feature branch.
- Docker build clone line.
- In-container test and mock-agent output.
- `ndx --help` output.
