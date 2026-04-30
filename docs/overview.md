# Overview

ndx is a TypeScript-first local coding agent runtime.

## Current Contract

- `src/cli/main.ts` is the active CLI entrypoint.
- CLI one-shot and interactive modes both run through `AgentRuntime`.
- `AgentRuntime` exposes a session/turn/submission/event protocol that future TUI, app-server, and tool registry work will reuse.
- `ndx` opens an interactive prompt when run without arguments from a TTY.
- Interactive slash commands are session-server controls exposed through `command/list` and `command/execute`.
- `/home/.ndx/settings.json` is the fixed global settings path.
- `/home/.ndx/sessions` is the default session origin; optional global
  `sessionPath` overrides only the session origin.
- Session files are partitioned by user, year, month, and session UUID. Omitted
  user is `defaultUser`.
- Project-local settings are discovered from the nearest `.ndx/settings.json` ancestor.
- `/home/.ndx/search.json` externalizes web-search parsing and interpretation rules.
- `keys` entries in settings are injected into shell tool executions.
- `--mock` runs the full agent/tool loop without a provider key.
- Real model execution uses the provider declared in settings. OpenAI-compatible providers try Responses first and fall back to Chat Completions when `/responses` is unavailable; Anthropic providers use Messages.
- Provider requests never depend on server-side response continuation state. The agent sends the local client-side conversation stack on every model request and does not send `previous_response_id`.
- Settings may define `model.session` and `model.custom` pools. Live sessions keep sticky model bindings per selected pool to preserve prefix-cache locality; `/model`, `/effort`, and `/think` can explicitly change model, effort, and thinking mode.
- Missing global `.ndx` directories and core tools are installed before config loading. If no settings file exists in a TTY CLI run, ndx asks for minimal provider/model settings and writes project `.ndx/settings.json`.

## Source Of Truth

The root TypeScript package, `src/`, `docs/`, and `tests/` are the active source
of truth for ndx behavior.
