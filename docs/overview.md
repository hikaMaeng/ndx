# Overview

ndx is being converted from the upstream Rust Codex codebase into a TypeScript-first agent runtime.

## Current Contract

- `src/cli.ts` is the active CLI entrypoint.
- `/home/ndx/.ndx/config.toml` is the default global config path.
- Project-local config is discovered from `.ndx/config.toml` files from filesystem root to the current working directory.
- `[env]` entries in config are injected into shell tool executions.
- `--mock` runs the full agent/tool loop without an OpenAI API key.
- Real model execution uses the OpenAI Responses API and the local `shell` function tool.

## Preserved Baseline

The imported openai/codex baseline is kept as local branch `origin` at commit `09f931e`.
