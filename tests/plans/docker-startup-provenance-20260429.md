# Test Plan: docker-startup-provenance
## Created
2026-04-29

## Goal
Verify that the long-running compose service prints enough startup provenance to identify the ndx package version, source Git ref, source commit, and runtime toolchain.

## Environment
- OS shell: bash
- Docker Compose service: `ndx-agent`
- Image source: GitHub clone selected by `NDX_GIT_REF`

## Preconditions
- Changes are pushed before the Docker image is built because the Dockerfile clones GitHub rather than copying local source.
- Docker is available.

## Steps
1. Run `npm test`.
2. Commit and push the Dockerfile change.
3. Run `docker compose down --remove-orphans`.
4. Run `NDX_GIT_REF=$(git branch --show-current) docker compose build --no-cache ndx-agent`.
5. Run `docker compose up -d ndx-agent`.
6. Run `docker compose logs --tail 40 ndx-agent`.

## Expected Results
- Logs contain `[ndx-image] package=ndx@0.1.0`.
- Logs contain `[ndx-image] git_remote=https://github.com/hikaMaeng/ndx.git`.
- Logs contain `[ndx-image] git_ref=<current branch>`.
- Logs contain `[ndx-image] git_commit=<40 character SHA>`.
- Logs contain `[ndx-image] git_subject=<latest pushed commit subject>`.
- The compose service remains `Up`.

## Logs To Capture
- `npm test` TAP summary.
- Docker build Git clone line.
- Compose startup provenance log lines.
- `docker compose ps` state.

## Locator Contract
No browser UI exists for this package. Browser locator contracts are not applicable.
