# Overview

ndx is a Turbo monorepo for a local coding agent. The active product surface is
split into app wrappers under `apps/`, domain logic under `packages/ndx`, root
documentation, agenttest suites under `test/`, and the Docker deploy flow.

## Runtime Shape

- `apps/ndx` publishes `@neurondev/ndx` and preserves the public `ndx` and
  `ndxserver` bins.
- `apps/ndxserver` is a private server wrapper for local workspace orchestration.
- `apps/toolcontainer` owns the Docker sandbox image build context.
- `packages/ndx` publishes `@neurondev/ndx-core` and owns CLI, server,
  dashboard, config, model, agent, runtime, tool, process, and shared logic.
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

Code-owned defaults are centralized in
`packages/ndx/src/config/defaults.ts`. User-editable model, provider, key,
tool, and MCP settings remain in settings JSON files.
AGENTS.md files and skill catalogs are loaded by their own cascades so runtime
instructions, `/context`, and compacted sessions can distinguish project-owned
guidance from user-owned guidance.

## Distribution

The install-facing package name remains `@neurondev/ndx`. It depends on
`@neurondev/ndx-core` and exposes the same `ndx` and `ndxserver` bins after
global install. Verdaccio is the default install-test registry. Public npm
publishing is explicit-only.
