# Overview

ndx is being converted from the upstream Rust Codex codebase into a TypeScript-first agent runtime.

## Current Contract

- `src/cli/main.ts` is the active CLI entrypoint.
- CLI one-shot and interactive modes both run through `AgentRuntime`.
- `AgentRuntime` exposes a session/turn/submission/event protocol that future TUI, app-server, and tool registry work will reuse.
- `ndx` opens an interactive prompt when run without arguments from a TTY.
- Interactive slash commands are session-server controls exposed through `command/list` and `command/execute`.
- `/home/.ndx/settings.json` is the fixed global settings path.
- Project-local settings are discovered from the nearest `.ndx/settings.json` ancestor.
- `/home/.ndx/search.json` externalizes web-search parsing and interpretation rules.
- `keys` entries in settings are injected into shell tool executions.
- `--mock` runs the full agent/tool loop without a provider key.
- Real model execution uses the provider declared in settings. OpenAI-compatible providers try Responses first and fall back to Chat Completions when `/responses` is unavailable; Anthropic providers use Messages.
- Missing global `.ndx` essentials are installed before config loading, including `settings.json` and the core shell tool.

## Preserved Baseline

The imported openai/codex baseline is kept as local branch `origin` at commit `09f931e`.
