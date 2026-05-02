# ndx TypeScript Workspace

## Scope

This repository is a TypeScript-first local coding agent. The active product
path is the root `ndx` package, `src/`, `tests/`, `docs/`, and Docker deploy
flow.

## Language And Style

- Default responses and task notes are Korean.
- Keep implementation work TypeScript and Node based.
- Do not add non-TypeScript native workspace dependencies.
- Prefer `rg` for search and existing TypeScript helpers before adding new
  abstractions.

## Build And Test

- Install dependencies with `yarn install --immutable`.
- Build with `yarn build`.
- Test with `yarn test`.
- Deploy verification uses `npm run deploy`.
- Publish install-test builds to Verdaccio at `https://verdaccio.neurondev.net/`.
- Publish to public npm only when the user explicitly asks for public npm.

## Documentation

- Keep root package documentation in `README.md` and `docs/`.
- Required docs are `overview`, `architecture`, `api`, `usage`, `constraints`,
  `internals`, and `testing`.
- Update docs with implementation changes.

## Runtime Boundary

- `/home/.ndx` is the global runtime directory.
- Core tools live under `/home/.ndx/core/tools`.
- Session tools, MCP adapters, worker launch, and process management are owned
  by the TypeScript runtime under `src/session` and `src/process`.
- The ndx server runs as a local host process. Docker is not the server body;
  Docker is only the per-workspace tool sandbox used for shell-like execution.
- The sandbox image is pinned by the server. The default image is
  `hika00/ndx-sandbox:0.1.0`, overrideable only by `NDX_SANDBOX_IMAGE` or
  `tools.dockerSandboxImage` for explicit verification.
- Any change to the sandbox Dockerfile or sandbox runtime contract must build,
  tag, push the image to Docker Hub under `hika00`, and test the server against
  that pushed tag before merge.
