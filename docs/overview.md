# Overview

ndx is a single TypeScript package for a local coding agent. The active product
surface is the root package, `src/`, `tests/`, `docs/`, and the Docker deploy
flow.

## Runtime Shape

- The CLI binary is `ndx`; `ndxserver` uses a bootstrap entrypoint to enter
  server mode without relying on npm shim command-name propagation.
- Normal `ndx` startup accepts only an optional server address. The default is
  `ws://127.0.0.1:45123`.
- If the requested server is not reachable, the CLI starts a local
  `SessionServer` host process for the current folder and connects to it.
- The server owns auth, live sessions, SQLite persistence, runtime events,
  dashboard HTTP, Docker sandbox preparation, and tool execution.
- Docker is not the server body. Docker provides the per-workspace sandbox used
  by external tools and MCP stdio commands.

## Configuration

Runtime settings are JSON files. Global settings live at
`/home/.ndx/settings.json`; a project override may live at
`<project>/.ndx/settings.json`. Global search rules live at
`/home/.ndx/search.json`.

Code-owned defaults are centralized in `src/config/defaults.ts`. User-editable
model, provider, key, tool, and MCP settings remain in settings JSON files.

## Distribution

The package name is `@neurondev/ndx`. Verdaccio is the default install-test
registry. Public npm publishing is explicit-only.
