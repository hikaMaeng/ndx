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

- Install dependencies with `pnpm install`.
- Build with `npm run build`.
- Test with `npm test`.
- Deploy verification uses `npm run deploy`.

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
