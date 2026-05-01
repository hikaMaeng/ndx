# Overview

ndx is a TypeScript-first local coding agent runtime.

## Current Contract

- `src/cli/main.ts` is the active CLI entrypoint.
- `ndx` remains the CLI command. `ndxserver` directly runs the long-lived
  server path.
- CLI one-shot and interactive modes both run through `AgentRuntime`.
- `AgentRuntime` exposes a session/turn/submission/event protocol that future TUI, app-server, and tool registry work will reuse.
- `ndx` first attaches to a workspace-managed Docker session server unless
  `--mock`, `--connect`, `serve`, `ndxserver`, or `NDX_EMBEDDED_SERVER=1` is
  used.
- If no workspace server is reachable, `ndx` asks a numbered setup question,
  writes compose state for the current folder, starts the container, and then
  connects.
- Interactive slash commands are session-server controls exposed through `command/list` and `command/execute`.
- `/home/.ndx/settings.json` is the fixed global settings path.
- `/home/.ndx-data` is the default SQLite data directory; optional `dataPath`
  overrides it and legacy `sessionPath` is treated as the same override.
- Accounts, social account links, sessions, events, and ownership are stored in
  `<dataDir>/ndx.sqlite`. Omitted user is `defaultUser`.
- Host CLI last-login state is stored in the CLI app-state directory. It is a
  single value shared by CLI instances and is separate from `/home/.ndx` and
  project `.ndx`.
- The server exposes a WebSocket socket port and a separate dashboard HTTP
  port. The dashboard has no auth; the socket requires account login after
  public initialization/account methods.
- Project-local settings are discovered from the nearest `.ndx/settings.json` ancestor.
- `/home/.ndx/search.json` externalizes web-search parsing and interpretation rules.
- `keys` entries in settings are injected into shell tool executions.
- `--mock` runs the full agent/tool loop without a provider key.
- Real model execution uses the provider declared in settings. OpenAI-compatible providers try Responses first and fall back to Chat Completions when `/responses` is unavailable; Anthropic providers use Messages.
- Provider requests never depend on server-side response continuation state. The agent sends the local client-side conversation stack on every model request and does not send `previous_response_id`.
- Settings may define `model.session` and `model.custom` pools. Live sessions keep sticky model bindings per selected pool to preserve prefix-cache locality; `/model`, `/effort`, and `/think` can explicitly change model, effort, and thinking mode.
- Missing global `.ndx` directories and core tools are installed before config loading. If no settings file exists in a TTY CLI run, ndx asks for minimal provider/model settings and writes project `.ndx/settings.json`.
- `/login` lets an interactive CLI choose Google, GitHub, current account, or
  `defaultUser`. Google and GitHub use device login and require
  `NDX_GOOGLE_CLIENT_ID` or `NDX_GITHUB_CLIENT_ID` in the host CLI environment.

## Source Of Truth

The root TypeScript package, `src/`, `docs/`, and `tests/` are the active source
of truth for ndx behavior.
