# Overview

ndx is being converted from the upstream Rust Codex codebase into a TypeScript-first agent runtime.

## Current Contract

- `src/cli.ts` is the active CLI entrypoint.
- `ndx` opens an interactive prompt when run without arguments from a TTY.
- `/home/.ndx/settings.json` is the fixed global settings path.
- Project-local settings are discovered from the nearest `.ndx/settings.json` ancestor.
- `/home/.ndx/search.json` externalizes web-search parsing and interpretation rules.
- `keys` entries in settings are injected into shell tool executions.
- `--mock` runs the full agent/tool loop without a provider key.
- Real model execution uses an OpenAI-compatible chat completions provider declared in settings.

## Preserved Baseline

The imported openai/codex baseline is kept as local branch `origin` at commit `09f931e`.
